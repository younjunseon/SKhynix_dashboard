"""
대시보드용 데이터 통합 스크립트.

입력: 4_output/final/zit_only/{oof,val,test}_{die,unit}.csv
출력: 5_dashboard/data/
  - die_predictions.parquet   (모든 split die-level 통합 + run_wf_xy 파싱)
  - unit_predictions.parquet  (모든 split unit-level 통합 + 집계 메타)
  - wafer_summary.parquet     (run_id × wafer_no 집계)
  - overview_stats.json       (전체 KPI: split별 RMSE, 위험 unit 수 등)

한 번 실행해서 산출물을 만들어두면 FastAPI는 이걸 메모리에 로드해서 서빙.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

# ─── 경로 ──────────────────────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(HERE)
sys.path.insert(0, PROJECT_ROOT)

SRC_DIR = os.path.join(PROJECT_ROOT, "4_output", "final", "zit_only")
XS_PATH = os.path.join(PROJECT_ROOT, "0_data", "compet_xs_data.csv")
OUT_DIR = os.path.join(HERE, "data")
os.makedirs(OUT_DIR, exist_ok=True)

# 위험도 기준: 절대 임계값이 아닌 pred 상위 비율로 정의
# (ZITboost pred는 분포가 좁아 절대 threshold가 의미 없음)
RISK_TOP_RATIO = 0.05  # 상위 5%

# 정상 baseline = 위험률(평균 pred) 하위 50% wafer
NORMAL_BASELINE_RATIO = 0.5


def load_split(split: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """split별 die/unit CSV 로드. split ∈ {'oof','val','test'}."""
    die = pd.read_csv(os.path.join(SRC_DIR, f"{split}_die.csv"))
    unit = pd.read_csv(os.path.join(SRC_DIR, f"{split}_unit.csv"))
    die["split"] = split
    unit["split"] = split
    return die, unit


def parse_run_wf_xy(df: pd.DataFrame) -> pd.DataFrame:
    """run_wf_xy = '{run_id}_{wafer_no}_{die_x}_{die_y}' 파싱."""
    parts = df["run_wf_xy"].str.split("_", expand=True)
    df = df.copy()
    df["run_id"] = parts[0]
    df["wafer_no"] = parts[1]
    df["die_x"] = parts[2].astype(int)
    df["die_y"] = parts[3].astype(int)
    df["wafer_key"] = df["run_id"] + "_" + df["wafer_no"]
    return df


def rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    mask = ~np.isnan(y_true)
    if mask.sum() == 0:
        return float("nan")
    return float(np.sqrt(np.mean((y_true[mask] - y_pred[mask]) ** 2)))


def main():
    print("[1/4] CSV 로드 + split 결합")
    die_frames, unit_frames = [], []
    for split in ["oof", "val", "test"]:
        die, unit = load_split(split)
        die_frames.append(die)
        unit_frames.append(unit)
        print(f"  {split}: die {len(die):,}, unit {len(unit):,}")

    die_all = pd.concat(die_frames, ignore_index=True)
    unit_all = pd.concat(unit_frames, ignore_index=True)
    print(f"  통합: die {len(die_all):,}, unit {len(unit_all):,}")

    print("[2/4] run_wf_xy 파싱")
    die_all = parse_run_wf_xy(die_all)
    print(f"  컬럼: {list(die_all.columns)}")

    # unit-level에 wafer 메타 붙이기 (unit 내 4 die는 동일 wafer)
    wafer_map = (
        die_all.groupby("ufs_serial")
        .agg(
            run_id=("run_id", "first"),
            wafer_no=("wafer_no", "first"),
            wafer_key=("wafer_key", "first"),
            die_x_mean=("die_x", "mean"),
            die_y_mean=("die_y", "mean"),
            pi_mean=("pi", "mean"),
            mu_mean=("mu", "mean"),
        )
        .reset_index()
    )
    unit_all = unit_all.merge(wafer_map, on="ufs_serial", how="left")
    # split별 상위 RISK_TOP_RATIO를 위험으로 라벨링 (split 간 비교 일관성 유지)
    unit_all["is_risk"] = False
    for split in unit_all["split"].unique():
        mask = unit_all["split"] == split
        thr = unit_all.loc[mask, "pred"].quantile(1 - RISK_TOP_RATIO)
        unit_all.loc[mask, "is_risk"] = unit_all.loc[mask, "pred"] > thr

    print("[3/4] wafer 집계")
    wafer_summary = (
        unit_all.groupby(["wafer_key", "run_id", "wafer_no", "split"])
        .agg(
            n_units=("ufs_serial", "count"),
            mean_pred=("pred", "mean"),
            max_pred=("pred", "max"),
            n_risk=("is_risk", "sum"),
            mean_health=("health", "mean"),
        )
        .reset_index()
    )
    wafer_summary["risk_ratio"] = wafer_summary["n_risk"] / wafer_summary["n_units"]
    print(f"  wafer 수: {wafer_summary['wafer_key'].nunique():,}")

    print("[4/4] overview KPI")
    overview = {
        "risk_top_ratio": RISK_TOP_RATIO,
        "splits": {},
        "totals": {
            "n_units": int(len(unit_all)),
            "n_dies": int(len(die_all)),
            "n_wafers": int(unit_all["wafer_key"].nunique()),
        },
    }
    for split in ["oof", "val", "test"]:
        sub = unit_all[unit_all["split"] == split]
        overview["splits"][split] = {
            "n_units": int(len(sub)),
            "rmse": rmse(sub["health"].values, sub["pred"].values),
            "n_risk": int(sub["is_risk"].sum()),
            "risk_ratio": float(sub["is_risk"].mean()),
            "pred_mean": float(sub["pred"].mean()),
            "pred_max": float(sub["pred"].max()),
            "health_zero_ratio": float((sub["health"] == 0).mean()),
        }

    # ─── [5/5] unit 단위 feature 평균 + 정상 unit baseline ───
    print("[5/5] unit feature 집계 + 정상 unit baseline 산출")
    print(f"  원본 X 로드: {XS_PATH}")
    xs = pd.read_csv(XS_PATH)
    feat_cols = [c for c in xs.columns if c.startswith("X")]
    print(f"  X feature 수: {len(feat_cols)}, die 수: {len(xs):,}")

    # unit 단위 feature 평균 (43,745 unit × 1,087 feature, 한 unit = die 4개 평균)
    unit_features = xs.groupby("ufs_serial")[feat_cols].mean().reset_index()
    print(f"  unit feature 매트릭스: {unit_features.shape}")

    # 정상 baseline: 평균 pred 하위 50% unit 선정
    threshold = unit_all["pred"].quantile(NORMAL_BASELINE_RATIO)
    normal_serials = set(unit_all.loc[unit_all["pred"] <= threshold, "ufs_serial"])
    normal_features = unit_features[unit_features["ufs_serial"].isin(normal_serials)]
    print(f"  정상 unit (pred 하위 {NORMAL_BASELINE_RATIO*100:.0f}%): {len(normal_serials):,}개")

    # feature별 정상 mean / std → baseline.parquet
    normal_baseline = pd.DataFrame({
        "feature": feat_cols,
        "normal_mean": normal_features[feat_cols].mean().values,
        "normal_std": normal_features[feat_cols].std().values,
    })
    # std=0인 feature는 z-score 무한대 방지를 위해 1e-9로 대체
    normal_baseline.loc[normal_baseline["normal_std"] < 1e-9, "normal_std"] = 1e-9

    # ─── 저장 ──────────────────────────────────────────────
    die_path = os.path.join(OUT_DIR, "die_predictions.parquet")
    unit_path = os.path.join(OUT_DIR, "unit_predictions.parquet")
    wafer_path = os.path.join(OUT_DIR, "wafer_summary.parquet")
    unit_feat_path = os.path.join(OUT_DIR, "unit_features.parquet")
    baseline_path = os.path.join(OUT_DIR, "normal_baseline.parquet")
    stats_path = os.path.join(OUT_DIR, "overview_stats.json")

    die_all.to_parquet(die_path, index=False)
    unit_all.to_parquet(unit_path, index=False)
    wafer_summary.to_parquet(wafer_path, index=False)
    unit_features.to_parquet(unit_feat_path, index=False)
    normal_baseline.to_parquet(baseline_path, index=False)
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(overview, f, indent=2, ensure_ascii=False)

    print("\n저장 완료:")
    for p in [die_path, unit_path, wafer_path, unit_feat_path, baseline_path, stats_path]:
        size_mb = os.path.getsize(p) / 1024 / 1024
        print(f"  {os.path.relpath(p, PROJECT_ROOT)}  ({size_mb:.2f} MB)")

    print("\nOverview RMSE:")
    for split, s in overview["splits"].items():
        print(f"  {split:5s}  RMSE={s['rmse']:.5f}  n_risk={s['n_risk']:,}/{s['n_units']:,}  ({s['risk_ratio']*100:.1f}%)")


if __name__ == "__main__":
    main()
