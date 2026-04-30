"""
대시보드 백엔드 (FastAPI).

prepare_data.py 산출물을 메모리에 로드해서 REST API로 서빙.

실행:
    cd 5_dashboard
    uvicorn api.main:app --reload --port 8000

엔드포인트:
    GET  /api/overview                       전체 KPI + split별 RMSE
    GET  /api/wafers                         wafer 리스트 (검색/필터)
    GET  /api/wafers/{wafer_key}             특정 wafer의 die-level 데이터 (wafer map용)
    GET  /api/units                          unit 리스트 (페이지네이션 + 정렬)
    GET  /api/units/{ufs_serial}             unit 상세 (4 die 분해 포함)
    GET  /api/health                         서버 상태
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

# ─── 경로 ──────────────────────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")


# ─── 데이터 로드 (앱 시작 시 1회) ────────────────────────
class DataStore:
    def __init__(self):
        print(f"[DataStore] 로드 시작: {DATA_DIR}")
        self.die = pd.read_parquet(os.path.join(DATA_DIR, "die_predictions.parquet"))
        self.unit = pd.read_parquet(os.path.join(DATA_DIR, "unit_predictions.parquet"))
        self.wafer = pd.read_parquet(os.path.join(DATA_DIR, "wafer_summary.parquet"))
        with open(os.path.join(DATA_DIR, "overview_stats.json"), encoding="utf-8") as f:
            self.overview = json.load(f)

        # 조회 성능을 위해 인덱스 설정
        self.unit_indexed = self.unit.set_index("ufs_serial", drop=False)
        self.die_by_unit = {k: g for k, g in self.die.groupby("ufs_serial")}
        self.die_by_wafer = {k: g for k, g in self.die.groupby("wafer_key")}

        print(f"  die  : {len(self.die):,} rows")
        print(f"  unit : {len(self.unit):,} rows")
        print(f"  wafer: {len(self.wafer):,} rows")


store: Optional[DataStore] = None


# ─── FastAPI 앱 ────────────────────────────────────────────
app = FastAPI(title="SK Hynix Wafer Dashboard API", version="0.1.0")

# React dev server (5173) 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    global store
    store = DataStore()


# ─── 유틸: NaN/inf → None 변환 (JSON 직렬화 안전) ──────
def _clean(v):
    if isinstance(v, float) and (np.isnan(v) or np.isinf(v)):
        return None
    return v


def _records(df: pd.DataFrame) -> list[dict]:
    """DataFrame → list[dict]. NaN/inf 안전 처리."""
    return json.loads(df.to_json(orient="records"))


# ─── 엔드포인트 ────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "data_loaded": store is not None}


@app.get("/api/overview")
def overview():
    """전체 KPI: split별 RMSE, 위험 unit 수, 전체 카운트."""
    return store.overview


@app.get("/api/wafers")
def list_wafers(
    split: Optional[str] = Query(None, description="oof/val/test"),
    sort: str = Query("risk_ratio", description="정렬 컬럼: risk_ratio | mean_pred | n_risk"),
    limit: int = Query(100, ge=1, le=1000),
):
    """wafer 리스트 (정렬 + 필터)."""
    df = store.wafer
    if split:
        df = df[df["split"] == split]
    if sort not in df.columns:
        raise HTTPException(400, f"invalid sort key: {sort}")
    df = df.sort_values(sort, ascending=False).head(limit)
    return {"count": len(df), "items": _records(df)}


@app.get("/api/wafers/{wafer_key}")
def wafer_detail(wafer_key: str):
    """특정 wafer의 die-level 데이터 (wafer map 시각화용)."""
    if wafer_key not in store.die_by_wafer:
        raise HTTPException(404, f"wafer not found: {wafer_key}")
    dies = store.die_by_wafer[wafer_key]
    units = store.unit[store.unit["wafer_key"] == wafer_key]

    summary_row = store.wafer[store.wafer["wafer_key"] == wafer_key]
    summary = _records(summary_row)[0] if len(summary_row) else None

    return {
        "wafer_key": wafer_key,
        "summary": summary,
        "dies": _records(dies[["ufs_serial", "run_wf_xy", "die_x", "die_y", "pi", "mu", "pred", "health", "split"]]),
        "units": _records(units[["ufs_serial", "pred", "health", "is_risk", "split"]]),
    }


@app.get("/api/units")
def list_units(
    split: Optional[str] = Query(None),
    risk_only: bool = Query(False, description="True면 is_risk=True만"),
    sort: str = Query("pred", description="정렬 컬럼: pred | health"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
):
    """unit 리스트 (페이지네이션)."""
    df = store.unit
    if split:
        df = df[df["split"] == split]
    if risk_only:
        df = df[df["is_risk"]]
    if sort not in df.columns:
        raise HTTPException(400, f"invalid sort key: {sort}")
    df = df.sort_values(sort, ascending=(order == "asc"))

    total = len(df)
    start = (page - 1) * page_size
    page_df = df.iloc[start : start + page_size]
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": _records(page_df),
    }


@app.get("/api/units/{ufs_serial}")
def unit_detail(ufs_serial: str):
    """unit 상세 + 4 die 분해."""
    if ufs_serial not in store.unit_indexed.index:
        raise HTTPException(404, f"unit not found: {ufs_serial}")
    unit_row = store.unit_indexed.loc[ufs_serial]
    if isinstance(unit_row, pd.DataFrame):
        unit_row = unit_row.iloc[0]

    dies = store.die_by_unit.get(ufs_serial, pd.DataFrame())

    return {
        "unit": _records(unit_row.to_frame().T)[0],
        "dies": _records(dies[["run_wf_xy", "die_x", "die_y", "pi", "one_minus_pi", "mu", "pred"]]),
    }


@app.get("/api/triage")
def triage(
    split: str = Query("test", description="oof/val/test"),
    top_units: int = Query(20, ge=1, le=200),
    top_wafers: int = Query(10, ge=1, le=50),
    unit_cost: float = Query(1000.0, description="가정 unit 단가 (₩)"),
):
    """
    위험 Unit 사전 탐지용 통합 KPI.
    - 위험 unit 수 + 추정 손실
    - 위험 wafer Top N
    - 위험 unit Top N (CSV 다운로드 가능)
    """
    unit = store.unit[store.unit["split"] == split]
    if len(unit) == 0:
        raise HTTPException(404, f"split not found: {split}")

    risk = unit[unit["is_risk"]].sort_values("pred", ascending=False)
    wafers_top = (
        store.wafer[store.wafer["split"] == split]
        .sort_values(["risk_ratio", "n_risk"], ascending=False)
        .head(top_wafers)
    )

    # 글로벌 색상 스케일 기준 (모든 wafer map 동일 기준 사용)
    global_pred_min = float(store.die["pred"].min())
    global_pred_max = float(store.die["pred"].max())
    global_threshold = float(store.unit[store.unit["split"] == split]["pred"].quantile(0.95))

    return {
        "split": split,
        "summary": {
            "n_units": int(len(unit)),
            "n_risk": int(len(risk)),
            "risk_ratio": float(len(risk) / len(unit)),
            "estimated_loss": float(len(risk) * unit_cost),
            "unit_cost": unit_cost,
            "rmse": store.overview["splits"][split]["rmse"],
        },
        "scale": {
            "pred_min": global_pred_min,
            "pred_max": global_pred_max,
            "risk_threshold": global_threshold,
        },
        "top_wafers": _records(wafers_top),
        "top_units": _records(risk.head(top_units)),
    }


@app.get("/api/lots")
def lots(
    split: str = Query("test"),
    sort: str = Query("risk_ratio"),
    limit: int = Query(50, ge=1, le=500),
):
    """Lot(run_id) 단위 위험도 집계 — 공정 개선 인사이트용."""
    unit = store.unit[store.unit["split"] == split]
    if len(unit) == 0:
        raise HTTPException(404, f"split not found: {split}")

    grouped = (
        unit.groupby("run_id")
        .agg(
            n_units=("ufs_serial", "count"),
            n_wafers=("wafer_no", "nunique"),
            n_risk=("is_risk", "sum"),
            mean_pred=("pred", "mean"),
            max_pred=("pred", "max"),
            mean_health=("health", "mean"),
        )
        .reset_index()
    )
    grouped["risk_ratio"] = grouped["n_risk"] / grouped["n_units"]
    grouped["lift"] = grouped["risk_ratio"] / unit["is_risk"].mean()  # 평균 대비 배수
    if sort not in grouped.columns:
        raise HTTPException(400, f"invalid sort: {sort}")
    grouped = grouped.sort_values(sort, ascending=False).head(limit)

    return {
        "split": split,
        "baseline_risk_ratio": float(unit["is_risk"].mean()),
        "n_lots_total": int(unit["run_id"].nunique()),
        "items": _records(grouped),
    }


@app.get("/api/lots/{run_id}")
def lot_detail(run_id: str, split: str = Query("test")):
    """단일 lot의 wafer별 risk + die 분포."""
    unit = store.unit[(store.unit["run_id"] == run_id) & (store.unit["split"] == split)]
    if len(unit) == 0:
        raise HTTPException(404, f"lot not found in split={split}: {run_id}")
    by_wafer = (
        unit.groupby(["wafer_key", "wafer_no"])
        .agg(
            n_units=("ufs_serial", "count"),
            n_risk=("is_risk", "sum"),
            mean_pred=("pred", "mean"),
            max_pred=("pred", "max"),
        )
        .reset_index()
    )
    by_wafer["risk_ratio"] = by_wafer["n_risk"] / by_wafer["n_units"]
    by_wafer = by_wafer.sort_values("risk_ratio", ascending=False)
    return {
        "run_id": run_id,
        "split": split,
        "summary": {
            "n_units": int(len(unit)),
            "n_wafers": int(unit["wafer_no"].nunique()),
            "n_risk": int(unit["is_risk"].sum()),
            "risk_ratio": float(unit["is_risk"].mean()),
            "mean_pred": float(unit["pred"].mean()),
            "max_pred": float(unit["pred"].max()),
        },
        "wafers": _records(by_wafer),
    }


@app.get("/api/units/{ufs_serial}/report")
def unit_report(ufs_serial: str):
    """unit 위험 진단 리포트 (의사결정 지원용)."""
    if ufs_serial not in store.unit_indexed.index:
        raise HTTPException(404, f"unit not found: {ufs_serial}")
    unit_row = store.unit_indexed.loc[ufs_serial]
    if isinstance(unit_row, pd.DataFrame):
        unit_row = unit_row.iloc[0]
    dies = store.die_by_unit.get(ufs_serial, pd.DataFrame())

    split = unit_row["split"]
    same_split = store.unit[store.unit["split"] == split]
    threshold = float(same_split["pred"].quantile(0.95))
    pred_rank = float((same_split["pred"] < unit_row["pred"]).mean())

    # 4 die 중 가장 위험한 die
    if len(dies) > 0:
        worst_idx = dies["pred"].idxmax()
        worst_die = dies.loc[worst_idx]
        worst = {
            "run_wf_xy": worst_die["run_wf_xy"],
            "die_x": int(worst_die["die_x"]),
            "die_y": int(worst_die["die_y"]),
            "pi": float(worst_die["pi"]),
            "mu": float(worst_die["mu"]),
            "pred": float(worst_die["pred"]),
        }
    else:
        worst = None

    # 자연어 진단 (템플릿 기반)
    pi_mean = float(unit_row["pi_mean"])
    mu_mean = float(unit_row["mu_mean"])
    is_risk = bool(unit_row["is_risk"])

    verdict = "WARNING" if is_risk else "NORMAL"
    sentences = []
    sentences.append(
        f"{ufs_serial}는 wafer {unit_row['wafer_key']}의 unit입니다 (split={split})."
    )
    if is_risk:
        sentences.append(
            f"pred {unit_row['pred']:.5f}로 split={split} 상위 5% 임계({threshold:.5f})를 초과 — 위험으로 분류됩니다."
        )
    else:
        sentences.append(
            f"pred {unit_row['pred']:.5f}로 split={split} 상위 5% 임계({threshold:.5f}) 이하입니다 (백분위 {pred_rank*100:.1f}%)."
        )
    if worst:
        sentences.append(
            f"4 die 중 die({worst['die_x']},{worst['die_y']})가 가장 위험 (pred {worst['pred']:.5f})."
        )
    if pi_mean < 0.3:
        sentences.append(
            f"pi 평균 {pi_mean:.3f}로 낮음 → 'zero가 아닐 확률이 큼'이 위험 신호."
        )
    elif pi_mean > 0.7:
        sentences.append(
            f"pi 평균 {pi_mean:.3f}로 높아 zero일 확률은 큼. mu(예상 health) {mu_mean:.5f}가 위험 기여."
        )

    return {
        "ufs_serial": ufs_serial,
        "verdict": verdict,
        "is_risk": is_risk,
        "pred": float(unit_row["pred"]),
        "health": float(unit_row["health"]) if pd.notna(unit_row["health"]) else None,
        "split": split,
        "wafer_key": unit_row["wafer_key"],
        "pred_rank": pred_rank,
        "threshold": threshold,
        "pi_mean": pi_mean,
        "mu_mean": mu_mean,
        "worst_die": worst,
        "narrative": sentences,
    }


@app.get("/")
def root():
    return {
        "service": "SK Hynix Wafer Dashboard API",
        "docs": "/docs",
        "endpoints": [
            "/api/overview",
            "/api/wafers",
            "/api/wafers/{wafer_key}",
            "/api/units",
            "/api/units/{ufs_serial}",
        ],
    }
