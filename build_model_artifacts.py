"""
대시보드 Model 페이지용 정적 산출물 빌드 (1회 실행).

입력
----
- 4_output/final/zit_only/fold_models.pkl   (5-fold ZITboost)
- 4_output/final/zit_only/oof_unit.csv      (OOF 예측: ufs_serial, pred, health)
- 0_data/compet_xs_data.csv                 (원본 X — split, X0~X1086)

출력 → 5_dashboard/data/model/
- fold_metrics.json        : fold별 RMSE + 평균/표준편차
- feature_importance.csv   : feature, mu_gain, pi_gain, total_gain (5-fold 평균)
- psi.csv                  : feature, psi (train ↔ validation)
- var_compare.csv          : feature, cohens_d, p_value (위험 unit pred>p95 vs 정상)
- shap_mu_unit.parquet     : unit-level SHAP (μ component, 5-fold 평균, die→unit mean)
- shap_pi_unit.parquet     : unit-level SHAP (π component, 5-fold 평균)
- shap_base.json           : base value (mu, pi) 5-fold 평균
- shap_summary.csv         : feature별 mean(|shap_mu|), mean(|shap_pi|) — 정렬용

추가 입력 (5번 SHAP 단계용)
- 0_data/compet_ys_*.csv (3개)            (load_all 통해 로드)
- 4_output/final/zit_only/oof_die.csv     (검증 가드용, 없으면 가드 스킵)
- 패키지: shap

산출물은 정적 (재실행 전까지 변경 X). FastAPI가 메모리 로드해 서빙.
재실행이 필요한 경우: 모델 재학습 / 원본 데이터 변경 / 위험 임계 변경.
"""
from __future__ import annotations
import json
import os
import pickle
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
# utils.config (SEED, KEY_COL 등)와 final.modules import용 — 둘 다 PROJECT_ROOT 기준
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "3_modeling"))

# 학습 코드의 KFold 함수를 그대로 재사용 — fold split 재현성 보장
from final.modules.hpo import _make_unit_folds  # noqa: E402

# SHAP 단계 (5번)에서만 사용 — 무거운 import는 main() 안에서 lazy import
# from final.modules import preprocess
# from utils.data import load_all, get_feat_cols, split_xs
# from utils.config import KEY_COL, TARGET_COL
# import shap

SEED = 42
N_FOLDS = 5
RISK_PERCENTILE = 0.95  # pred 상위 5%를 위험군으로 정의

# SHAP 산출 시 학습 시점 전처리 파라미터 (01_zit_only.ipynb과 동일)
# - PARAMS={} (DEFAULT_PARAMS) + CLIP_Y_EXTREME=True
# - 다른 PARAMS로 학습한 pkl이라면 5-2 검증 가드에서 RMSE 불일치로 raise됨
SHAP_PARAMS: dict = {}
SHAP_CLIP_Y_EXTREME = True
SHAP_RMSE_TOL = 1e-6  # 재예측 RMSE vs 저장된 oof_unit.csv RMSE 허용 오차

OUT_DIR = HERE / "data" / "model"
OUT_DIR.mkdir(parents=True, exist_ok=True)

XS_PATH = PROJECT_ROOT / "0_data" / "compet_xs_data.csv"
OOF_PATH = PROJECT_ROOT / "4_output" / "final" / "zit_only" / "oof_unit.csv"
FM_PATH = PROJECT_ROOT / "4_output" / "final" / "zit_only" / "fold_models.pkl"


def log(msg: str) -> None:
    print(f"[build] {msg}", flush=True)


def calc_psi(a: np.ndarray, b: np.ndarray, n_bins: int = 10) -> float:
    """train 분포 a, val 분포 b 간 Population Stability Index.

    PSI < 0.1   안정
    0.1 ~ 0.25  보통 (모니터링)
    > 0.25      유의미한 분포 변화
    """
    a = a[~np.isnan(a)]
    b = b[~np.isnan(b)]
    if len(a) == 0 or len(b) == 0 or np.std(a) < 1e-12:
        return 0.0
    edges = np.unique(np.quantile(a, np.linspace(0, 1, n_bins + 1)))
    if len(edges) < 3:
        return 0.0
    a_hist, _ = np.histogram(a, bins=edges)
    b_hist, _ = np.histogram(b, bins=edges)
    eps = 1e-6
    a_pct = (a_hist + eps) / (a_hist.sum() + eps * len(a_hist))
    b_pct = (b_hist + eps) / (b_hist.sum() + eps * len(b_hist))
    return float(np.sum((a_pct - b_pct) * np.log(a_pct / b_pct)))


def build_shap_artifacts(fm: dict, oof: pd.DataFrame) -> dict:
    """SHAP 산출물 생성 (μ, π 분리, 5-fold 평균, unit-level mean 집계).

    절차
    ----
    1. utils.data.load_all() + preprocess.run() 으로 die-level 전처리본 재구성
       (01_zit_only.ipynb와 동일 — PARAMS=SHAP_PARAMS, CLIP_Y_EXTREME 적용)
    2. 검증 가드: feat_cols가 pkl의 feature_names와 일치하는지 + die-level OOF 재예측이
       기존 oof_die.csv와 SHAP_RMSE_TOL 이내로 일치하는지 검사
       (어긋나면 학습 시점 PARAMS가 다르다는 뜻 → raise)
    3. 각 fold 모델의 lgb_mu_, lgb_pi_ 에 TreeExplainer → train + val + test
       die-level shap 5-fold 평균
    4. die→unit mean 집계 (학습 시 unit pred = die pred mean과 동일 규약)
    5. parquet/json/csv 저장
    """
    import shap as _shap  # noqa: WPS433
    from final.modules import preprocess as _pp  # noqa: WPS433
    from utils.data import load_all, get_feat_cols, split_xs  # noqa: WPS433
    from utils.config import KEY_COL, TARGET_COL  # noqa: WPS433

    feature_names: list[str] = list(fm["feature_names"])
    fold_models = fm["fold_models"]
    n_feat = len(feature_names)

    # ── 1. 전처리 재실행 ──────────────────────────────────────
    log("  [5-1] load_all + preprocess.run (PARAMS={} = DEFAULT_PARAMS)")
    xs, ys = load_all()
    feat_cols_raw = get_feat_cols(xs)
    xs_dict = split_xs(xs)

    ys_input = {k: v.copy() for k, v in ys.items()}
    if SHAP_CLIP_Y_EXTREME:
        y_raw = ys_input["train"][TARGET_COL]
        second_max = y_raw[y_raw < y_raw.max()].max()
        n_clipped = int((y_raw >= 1.0).sum())
        ys_input["train"][TARGET_COL] = y_raw.clip(upper=second_max)
        log(f"  [CLIP_Y_EXTREME] {y_raw.max():.6f} → {second_max:.6f} "
            f"({n_clipped}개 clip)")

    pp = _pp.run(xs, ys_input, feat_cols_raw, xs_dict, params=SHAP_PARAMS)
    xs_train = pp["xs_train"]
    xs_val = pp["xs_val"]
    xs_test = pp["xs_test"]
    feat_cols_clean: list[str] = pp["feat_cols"]
    log(f"  전처리 완료: train={xs_train.shape}, val={xs_val.shape}, "
        f"test={xs_test.shape}, feat={len(feat_cols_clean)}")

    # ── 2. 검증 가드 ─────────────────────────────────────────
    log("  [5-2] 검증 가드: feat_cols 일치 + OOF die 재현")
    if feat_cols_clean != feature_names:
        diff_a = set(feat_cols_clean) - set(feature_names)
        diff_b = set(feature_names) - set(feat_cols_clean)
        raise RuntimeError(
            "feat_cols 불일치 — preprocess 결과가 학습 시점과 다름. "
            f"전처리 추가({len(diff_a)}): {sorted(diff_a)[:5]}, "
            f"전처리 누락({len(diff_b)}): {sorted(diff_b)[:5]}"
        )

    X_train = xs_train[feature_names].values
    X_val = xs_val[feature_names].values
    X_test = xs_test[feature_names].values
    log(f"  X shape: train={X_train.shape}, val={X_val.shape}, test={X_test.shape}")

    # OOF 재예측 (refit_best와 동일 로직: fold별 holdout만 채움)
    train_units = ys_input["train"][KEY_COL].unique()
    folds = _make_unit_folds(train_units, N_FOLDS, SEED)

    n_tr_die = len(xs_train)
    oof_pred_die = np.full(n_tr_die, np.nan)
    val_pred_die = np.zeros(len(xs_val))
    test_pred_die = np.zeros(len(xs_test))

    for i, ((_tr, vl_units), model) in enumerate(zip(folds, fold_models)):
        vl_mask = xs_train[KEY_COL].isin(set(vl_units)).values
        oof_pred_die[vl_mask] = model.predict(X_train[vl_mask])
        val_pred_die += model.predict(X_val) / N_FOLDS
        test_pred_die += model.predict(X_test) / N_FOLDS
        log(f"    fold {i+1}/{N_FOLDS} predict done")

    if np.isnan(oof_pred_die).any():
        raise RuntimeError("OOF 재예측에 NaN — fold split 재현 실패")

    # 저장된 oof_die.csv와 die-level pred 직접 비교 (가장 엄격한 가드)
    oof_die_path = OOF_PATH.parent / "oof_die.csv"
    if oof_die_path.exists():
        oof_die_saved = pd.read_csv(oof_die_path, usecols=["pred"])
        if len(oof_die_saved) != n_tr_die:
            raise RuntimeError(
                f"oof_die.csv 행수 불일치: 저장 {len(oof_die_saved)} vs "
                f"재예측 {n_tr_die}"
            )
        diff_max = float(np.max(np.abs(oof_die_saved["pred"].values - oof_pred_die)))
        log(f"  oof_die pred max abs diff = {diff_max:.2e}")
        if diff_max > SHAP_RMSE_TOL:
            raise RuntimeError(
                f"OOF 재예측 불일치 (max abs diff={diff_max:.2e} > tol={SHAP_RMSE_TOL}). "
                "학습 시점 PARAMS가 SHAP_PARAMS({})와 다를 가능성 — "
                "study_meta.effective_pp_params 확인 후 SHAP_PARAMS에 반영 필요."
            )
        log("  ✓ OOF die 예측 일치 — 학습 시점 전처리 재현 확인")
    else:
        log(f"  ⚠ {oof_die_path.name} 없음 — die-level diff 가드 스킵")

    # ── 3. SHAP 계산 (die-level, 5-fold 평균) ──────────────────
    log("  [5-3] TreeExplainer (lgb_mu, lgb_pi) × 5 fold")
    shap_mu_train = np.zeros((n_tr_die, n_feat), dtype=np.float32)
    shap_mu_val = np.zeros((len(xs_val), n_feat), dtype=np.float32)
    shap_mu_test = np.zeros((len(xs_test), n_feat), dtype=np.float32)
    shap_pi_train = np.zeros_like(shap_mu_train)
    shap_pi_val = np.zeros_like(shap_mu_val)
    shap_pi_test = np.zeros_like(shap_mu_test)
    mu_base = 0.0
    pi_base = 0.0

    for i, model in enumerate(fold_models):
        ex_mu = _shap.TreeExplainer(model.lgb_mu_)
        ex_pi = _shap.TreeExplainer(model.lgb_pi_)
        shap_mu_train += ex_mu.shap_values(X_train).astype(np.float32) / N_FOLDS
        shap_mu_val += ex_mu.shap_values(X_val).astype(np.float32) / N_FOLDS
        shap_mu_test += ex_mu.shap_values(X_test).astype(np.float32) / N_FOLDS
        shap_pi_train += ex_pi.shap_values(X_train).astype(np.float32) / N_FOLDS
        shap_pi_val += ex_pi.shap_values(X_val).astype(np.float32) / N_FOLDS
        shap_pi_test += ex_pi.shap_values(X_test).astype(np.float32) / N_FOLDS
        mu_base += float(np.asarray(ex_mu.expected_value).ravel()[0]) / N_FOLDS
        pi_base += float(np.asarray(ex_pi.expected_value).ravel()[0]) / N_FOLDS
        log(f"    fold {i+1}/{N_FOLDS} SHAP done")

    # ── 4. die→unit mean 집계 ────────────────────────────────
    log("  [5-4] die→unit mean 집계")

    def _die_to_unit_shap(xs_split: pd.DataFrame, shap_die: np.ndarray) -> pd.DataFrame:
        df = pd.DataFrame(shap_die, columns=feature_names)
        df[KEY_COL] = xs_split[KEY_COL].values
        return df.groupby(KEY_COL, sort=False)[feature_names].mean().reset_index()

    mu_units = []
    pi_units = []
    for split_name, xs_split, sh_mu, sh_pi in [
        ("train", xs_train, shap_mu_train, shap_pi_train),
        ("validation", xs_val, shap_mu_val, shap_pi_val),
        ("test", xs_test, shap_mu_test, shap_pi_test),
    ]:
        mu_u = _die_to_unit_shap(xs_split, sh_mu)
        pi_u = _die_to_unit_shap(xs_split, sh_pi)
        mu_u["split"] = split_name
        pi_u["split"] = split_name
        mu_units.append(mu_u)
        pi_units.append(pi_u)

    shap_mu_unit = pd.concat(mu_units, ignore_index=True)
    shap_pi_unit = pd.concat(pi_units, ignore_index=True)
    log(f"  unit-level shape: mu={shap_mu_unit.shape}, pi={shap_pi_unit.shape}")

    # ── 5. 저장 ──────────────────────────────────────────────
    log("  [5-5] 저장")
    shap_mu_unit.to_parquet(OUT_DIR / "shap_mu_unit.parquet", index=False)
    shap_pi_unit.to_parquet(OUT_DIR / "shap_pi_unit.parquet", index=False)

    with (OUT_DIR / "shap_base.json").open("w", encoding="utf-8") as f:
        json.dump({"mu_base": mu_base, "pi_base": pi_base}, f, indent=2)

    summary = pd.DataFrame({
        "feature": feature_names,
        "mean_abs_shap_mu": np.abs(shap_mu_unit[feature_names].values).mean(axis=0),
        "mean_abs_shap_pi": np.abs(shap_pi_unit[feature_names].values).mean(axis=0),
    })
    summary["mean_abs_shap_total"] = (
        summary["mean_abs_shap_mu"] + summary["mean_abs_shap_pi"]
    )
    summary = (summary.sort_values("mean_abs_shap_total", ascending=False)
               .reset_index(drop=True))
    summary.to_csv(OUT_DIR / "shap_summary.csv", index=False)
    log(f"  → shap_summary.csv (Top 5: "
        f"{', '.join(summary['feature'].head(5).tolist())})")

    return {
        "n_units": int(len(shap_mu_unit)),
        "n_features": n_feat,
        "mu_base": mu_base,
        "pi_base": pi_base,
        "params_used": {
            "SHAP_PARAMS": SHAP_PARAMS,
            "CLIP_Y_EXTREME": SHAP_CLIP_Y_EXTREME,
        },
    }


def main() -> None:
    t0 = time.time()
    log(f"OUT_DIR: {OUT_DIR}")

    # ─── 1. fold별 RMSE ─────────────────────────────────────────
    log("[1/5] fold별 RMSE")
    oof = pd.read_csv(OOF_PATH)
    if not {"ufs_serial", "pred", "health"}.issubset(oof.columns):
        raise RuntimeError(f"oof_unit.csv 컬럼 부족: {oof.columns.tolist()}")
    train_units = np.array(sorted(oof["ufs_serial"].unique()))
    folds = _make_unit_folds(train_units, n_splits=N_FOLDS, seed=SEED)

    fold_rows = []
    for i, (_tr, vl) in enumerate(folds):
        sub = oof[oof["ufs_serial"].isin(vl)]
        if len(sub) == 0:
            continue
        rmse = float(np.sqrt(((sub["pred"] - sub["health"]) ** 2).mean()))
        fold_rows.append({"fold": i + 1, "rmse": rmse, "n_units": int(len(sub))})
        log(f"  fold{i+1}: RMSE={rmse:.5f} (n={len(sub):,})")

    fold_metrics = {
        "n_folds": N_FOLDS,
        "seed": SEED,
        "folds": fold_rows,
        "mean_rmse": float(np.mean([r["rmse"] for r in fold_rows])),
        "std_rmse": float(np.std([r["rmse"] for r in fold_rows])),
        "n_total_units": int(len(oof)),
    }
    with (OUT_DIR / "fold_metrics.json").open("w", encoding="utf-8") as f:
        json.dump(fold_metrics, f, indent=2, ensure_ascii=False)
    log(
        f"  → fold_metrics.json (mean={fold_metrics['mean_rmse']:.5f}, "
        f"std={fold_metrics['std_rmse']:.5f})"
    )

    # ─── 2. feature importance (mu, pi 5-fold 평균) ─────────────
    log("[2/5] feature importance")
    with FM_PATH.open("rb") as f:
        fm = pickle.load(f)
    feature_names: list[str] = list(fm["feature_names"])
    n_feat = len(feature_names)
    mu_imp = np.zeros(n_feat)
    pi_imp = np.zeros(n_feat)
    for model in fm["fold_models"]:
        mu_imp += model.lgb_mu_.booster_.feature_importance(importance_type="gain")
        pi_imp += model.lgb_pi_.booster_.feature_importance(importance_type="gain")
    mu_imp /= len(fm["fold_models"])
    pi_imp /= len(fm["fold_models"])
    fi_df = (
        pd.DataFrame(
            {
                "feature": feature_names,
                "mu_gain": mu_imp,
                "pi_gain": pi_imp,
                "total_gain": mu_imp + pi_imp,
            }
        )
        .sort_values("total_gain", ascending=False)
        .reset_index(drop=True)
    )
    fi_df.to_csv(OUT_DIR / "feature_importance.csv", index=False)
    log(
        f"  → feature_importance.csv (Top 5: "
        f"{', '.join(fi_df['feature'].head(5).tolist())})"
    )

    # ─── 3. PSI (train ↔ validation) ────────────────────────────
    log("[3/5] PSI (train ↔ validation)")
    # 원본 X csv의 실제 컬럼만 사용 (_missing 같은 derived feature는 제외)
    xs_header = pd.read_csv(XS_PATH, nrows=0)
    xs_x_cols = {c for c in xs_header.columns if c.startswith("X")}
    feat_in_xs = [c for c in feature_names if c in xs_x_cols]
    log(
        f"  feature 매칭 {len(feat_in_xs)}개 (모델 {n_feat}개 중 원본 X에 있는 것만, "
        f"derived {n_feat - len(feat_in_xs)}개 제외)"
    )
    use_cols = ["ufs_serial", "split"] + feat_in_xs
    log(f"  X 데이터 로드 (rows ~ 175k × cols {len(use_cols)})")
    xs = pd.read_csv(XS_PATH, usecols=use_cols)
    log(f"  unit 단위 mean 집계 ({len(xs):,} die)")
    xs_unit = (
        xs.groupby(["ufs_serial", "split"], as_index=False)[feat_in_xs].mean()
    )
    train_X = xs_unit[xs_unit["split"] == "train"][feat_in_xs]
    val_X = xs_unit[xs_unit["split"] == "validation"][feat_in_xs]
    log(f"  PSI 계산 (train {len(train_X):,} unit × val {len(val_X):,} unit)")

    psi_rows = []
    for c in feat_in_xs:
        psi_rows.append(
            {
                "feature": c,
                "psi": calc_psi(train_X[c].values, val_X[c].values),
            }
        )
    psi_df = (
        pd.DataFrame(psi_rows).sort_values("psi", ascending=False).reset_index(drop=True)
    )
    psi_df.to_csv(OUT_DIR / "psi.csv", index=False)
    log(
        f"  → psi.csv (Top 5: "
        f"{', '.join(psi_df['feature'].head(5).tolist())}, "
        f"max={psi_df['psi'].max():.3f})"
    )

    # ─── 4. 위험군 vs 정상군 t-test + Cohen's d ────────────────
    log("[4/5] 위험군 vs 정상군 변수 비교")
    threshold = float(oof["pred"].quantile(RISK_PERCENTILE))
    risk_units = set(oof[oof["pred"] > threshold]["ufs_serial"])
    log(
        f"  threshold pred>{threshold:.5f} (q={RISK_PERCENTILE:.2f}), "
        f"위험 unit {len(risk_units):,}"
    )

    # train split만 — val/test는 아직 health 미공개 가정
    train_unit_X = xs_unit[xs_unit["split"] == "train"].copy()
    is_risk = train_unit_X["ufs_serial"].isin(risk_units).values
    g_risk = train_unit_X.loc[is_risk, feat_in_xs]
    g_norm = train_unit_X.loc[~is_risk, feat_in_xs]
    log(f"  group 위험 {len(g_risk):,} / 정상 {len(g_norm):,}")

    var_rows = []
    for c in feat_in_xs:
        a = g_risk[c].values
        b = g_norm[c].values
        sa = np.nanstd(a, ddof=1) if len(a) > 1 else 0.0
        sb = np.nanstd(b, ddof=1) if len(b) > 1 else 0.0
        if sa + sb < 1e-12:
            continue
        try:
            tstat, p = stats.ttest_ind(a, b, equal_var=False, nan_policy="omit")
        except Exception:
            continue
        # Cohen's d (pooled std)
        pooled = np.sqrt(
            ((len(a) - 1) * sa ** 2 + (len(b) - 1) * sb ** 2)
            / max(len(a) + len(b) - 2, 1)
        )
        d = float((np.nanmean(a) - np.nanmean(b)) / pooled) if pooled > 0 else 0.0
        var_rows.append(
            {
                "feature": c,
                "cohens_d": d,
                "abs_d": abs(d),
                "p_value": float(p) if not np.isnan(p) else 1.0,
                "mean_risk": float(np.nanmean(a)),
                "mean_norm": float(np.nanmean(b)),
                "n_risk": int(len(a)),
                "n_norm": int(len(b)),
            }
        )
    var_df = (
        pd.DataFrame(var_rows)
        .sort_values("abs_d", ascending=False)
        .drop(columns="abs_d")
        .reset_index(drop=True)
    )
    var_df.to_csv(OUT_DIR / "var_compare.csv", index=False)
    log(
        f"  → var_compare.csv (Top 5: "
        f"{', '.join(var_df['feature'].head(5).tolist())})"
    )

    # ─── 5. SHAP (μ, π 각각, 5-fold 평균, unit-level) ───────────
    log("[5/5] SHAP (μ, π) — preprocess 재실행 + TreeExplainer")
    shap_outputs = build_shap_artifacts(fm, oof)

    # ─── manifest ──────────────────────────────────────────────
    manifest = {
        "built_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "seed": SEED,
        "n_folds": N_FOLDS,
        "risk_percentile": RISK_PERCENTILE,
        "n_features": n_feat,
        "n_features_in_xs": len(feat_in_xs),
        "shap": shap_outputs,  # dict: 검증 가드 결과 + 저장 파일 메타
        "outputs": {
            "fold_metrics.json": "fold별 RMSE",
            "feature_importance.csv": "5-fold 평균 LGBM gain (mu/pi)",
            "psi.csv": "train ↔ validation 분포 변화",
            "var_compare.csv": "위험 vs 정상 unit 변수 비교 (t-test + Cohen's d)",
            "shap_mu_unit.parquet": "unit-level SHAP (μ component, 5-fold 평균, die→unit mean)",
            "shap_pi_unit.parquet": "unit-level SHAP (π component, 5-fold 평균, die→unit mean)",
            "shap_base.json": "base value (mu, pi) 5-fold 평균",
            "shap_summary.csv": "feature별 mean(|shap_mu|), mean(|shap_pi|) — 정렬용",
        },
    }
    with (OUT_DIR / "manifest.json").open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    log(f"전체 완료 ({time.time() - t0:.1f}s) - 산출물 9종 (manifest 포함) -> {OUT_DIR}")


if __name__ == "__main__":
    main()
