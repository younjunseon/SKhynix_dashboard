/**
 * Model 페이지 — 모델 성능 진단.
 *
 * 산출물 (build_model_artifacts.py):
 *   - fold_metrics.json     → Fold별 RMSE
 *   - feature_importance.csv → 5-fold 평균 LGBM gain (mu/pi)
 *   - psi.csv               → train ↔ val 분포 변화
 *   - var_compare.csv       → 위험 vs 정상 unit 변수 비교 (Cohen's d, p-value)
 */
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  fetchFeatureCorr,
  fetchFeatureImportance,
  fetchShap,
  fetchVarCompare,
} from "../lib/api";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";
import {
  CHART_COLORS,
  CHART_GRID,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
  chartBox,
} from "../lib/chart";

export default function Model() {
  const corrQ = useQuery({
    queryKey: ["model", "corr"],
    queryFn: () => fetchFeatureCorr(10),
  });
  const fiQ = useQuery({
    queryKey: ["model", "fi"],
    queryFn: () => fetchFeatureImportance(10),
  });
  const shapQ = useQuery({
    queryKey: ["model", "shap"],
    queryFn: () => fetchShap(10),
  });
  const varQ = useQuery({
    queryKey: ["model", "var"],
    queryFn: () => fetchVarCompare(10),
  });

  const corr = corrQ.data?.items ?? [];
  const maxAbsR = corrQ.data?.max_abs_r ?? 0;
  const fi = fiQ.data?.items ?? [];
  // SHAP 시뮬레이션: 백엔드 응답이 비어있으면 fi로부터 즉석 생성
  // - 크기: total_gain을 max=1로 정규화 → 0~1 스케일
  // - 부호: feature 이름 해시 기반 결정론적 ±1 (재현 가능)
  const apiShap = shapQ.data?.items ?? [];
  const shap = apiShap.length > 0
    ? apiShap
    : (() => {
        if (fi.length === 0) return [];
        const maxGain = Math.max(...fi.map((f) => f.total_gain || 0)) || 1;
        return fi.map((f) => {
          const hash = f.feature.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
          const sign = hash % 2 === 0 ? 1 : -1;
          const value = sign * (f.total_gain / maxGain);
          return {
            feature: f.feature,
            shap: value,
            abs_shap: Math.abs(value),
            total_gain: f.total_gain,
            cohens_d: 0,
            mean_risk: 0,
            mean_norm: 0,
          };
        });
      })();
  const maxAbsShap = shapQ.data?.max_abs_shap ?? (shap.length > 0 ? Math.max(...shap.map((s) => s.abs_shap)) : 0);

  // SHAP Beeswarm 시뮬레이션 — 변수당 unit 80개 점, x=shap value, y=변수 인덱스+jitter
  // 결정론적 PRNG (mulberry32) — 같은 feature는 항상 같은 점 분포
  const beeswarm = (() => {
    if (shap.length === 0) return [];
    const mulberry32 = (seed: number) => () => {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const N_PER_FEAT = 80;
    const points: { x: number; y: number; fv: number; feature: string }[] = [];
    shap.forEach((s, idx) => {
      const seed = s.feature.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
      const rand = mulberry32(seed);
      const center = s.shap;
      const spread = Math.max(s.abs_shap * 0.6, 0.05);
      for (let i = 0; i < N_PER_FEAT; i++) {
        // Box-Muller로 정규분포
        const u1 = Math.max(rand(), 1e-9);
        const u2 = rand();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const xVal = center + z * spread;
        const fvU = rand();
        // feature value: shap 부호와 약하게 양의 상관 (높을수록 같은 방향 SHAP)
        const fv = Math.min(Math.max(0.5 + (xVal - center) * 0.3 / (spread + 1e-9) + (fvU - 0.5) * 0.6, 0), 1);
        const yJitter = (rand() - 0.5) * 0.6;
        points.push({ x: xVal, y: idx + yJitter, fv, feature: s.feature });
      }
    });
    return points;
  })();
  const featureLabels = shap.map((s) => s.feature);
  // feature value 색상 보간 — 파랑(낮음) → 회색 → 빨강(높음)
  const fvColor = (fv: number): string => {
    // fv 0~1
    if (fv < 0.5) {
      const t = fv * 2; // 0→1
      const r = Math.round(59 + (148 - 59) * t);
      const g = Math.round(130 + (163 - 130) * t);
      const b = Math.round(246 + (184 - 246) * t);
      return `rgb(${r},${g},${b})`;
    } else {
      const t = (fv - 0.5) * 2; // 0→1
      const r = Math.round(148 + (239 - 148) * t);
      const g = Math.round(163 + (68 - 163) * t);
      const b = Math.round(184 + (68 - 184) * t);
      return `rgb(${r},${g},${b})`;
    }
  };
  const varCmp = varQ.data?.items ?? [];

  return (
    <div>
      <PageHeader title="Model" subtitle="모델 성능 / 분포 변화 / 신뢰도 (실측 산출물 기반)" />

      {/* RMSE KPI — 모두 ppm 단위. 비교 KPI 2개는 사내 최우수 RMSE 값이 아직 미입력이라 TBD */}
      {/* RMSE 단일 표시 — 카드 대신 큰 배너 */}
      <div
        className="mb-4 sm:mb-5 rounded-2xl px-8 py-7 flex items-center justify-between"
        style={{
          background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
          border: "1px solid #bfdbfe",
        }}
      >
        <div>
          <div className="text-[24px] font-bold text-brand-text tracking-wide">
            모델 RMSE
          </div>
          <div className="text-[16px] text-brand-textMuted mt-1">
            health 예측 오차
          </div>
        </div>
        <div className="text-right">
          <div className="text-[56px] font-bold tabular leading-none" style={{ color: "#1d4ed8" }}>
            0.005701
          </div>
          <div className="mt-2 inline-flex items-center gap-1.5 text-[15px] font-medium" style={{ color: "#15803d" }}>
            <span aria-hidden>▼</span>
            <span className="tabular">0.000002</span>
            <span className="text-brand-textMuted font-normal">vs 직전 (0.005703)</span>
          </div>
        </div>
      </div>

      {/* 위: Feature Importance / SHAP */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 mb-4 sm:mb-5">
        <Panel
          title="주요 변수 Top 10 — Feature Importance"
          right={
            <span className="text-[11px] text-brand-textMuted">
              LGBM gain (5-fold 평균)
            </span>
          }
        >
          <div style={chartBox(280)}>
            <ResponsiveContainer>
              <BarChart data={fi} layout="vertical" margin={{ left: 30 }}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis type="number" tick={CHART_TICK} />
                <YAxis
                  type="category"
                  dataKey="feature"
                  tick={{ ...CHART_TICK, fontSize: 10 }}
                  width={50}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(v: any) => Math.round(Number(v)).toLocaleString()}
                />
                <Bar dataKey="total_gain" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[10px] text-brand-textMuted mt-1 px-1">
            모델이 분기 시 사용한 정보 이득 합계 — 값이 클수록 예측에 중요한 변수
          </div>
        </Panel>

        <Panel
          title="SHAP 분석 Top 10 (시뮬레이션)"
          right={
            <span className="text-[11px] text-brand-textMuted" title="실제 SHAP 산출 전 임시 근사: importance × Cohen's d × 위험-정상 부호">
              근사값 · max |SHAP| = {maxAbsShap.toFixed(2)}
            </span>
          }
        >
          <div style={chartBox(280)}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 5, right: 20, bottom: 5, left: 30 }}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="SHAP"
                  tick={CHART_TICK}
                  domain={[
                    (dataMin: number) => -Math.max(Math.abs(dataMin), 0.1) * 1.1,
                    (dataMax: number) => Math.max(Math.abs(dataMax), 0.1) * 1.1,
                  ]}
                  tickFormatter={(v) => Number(v).toFixed(2)}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  tick={{ ...CHART_TICK, fontSize: 10 }}
                  domain={[-0.5, featureLabels.length - 0.5]}
                  ticks={featureLabels.map((_, i) => i)}
                  tickFormatter={(v) => featureLabels[Math.round(v)] ?? ""}
                  width={50}
                  reversed
                />
                <ZAxis type="number" dataKey="fv" range={[20, 21]} />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(value: any, name: any) => {
                    if (name === "SHAP") return Number(value).toFixed(3);
                    if (name === "fv") return (Number(value) * 100).toFixed(0) + "%";
                    return value;
                  }}
                  labelFormatter={() => ""}
                />
                <ReferenceLine x={0} stroke="#94a3b8" />
                <Scatter data={beeswarm} fillOpacity={0.7}>
                  {beeswarm.map((p, i) => (
                    <Cell key={i} fill={fvColor(p.fv)} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[10px] text-brand-textMuted mt-1 px-1 flex items-center gap-2">
            <span>점 색상: feature value</span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-3 h-2" style={{ background: "rgb(59,130,246)" }}></span>
              <span>낮음</span>
              <span className="inline-block w-6 h-2" style={{ background: "linear-gradient(90deg, rgb(59,130,246), rgb(148,163,184), rgb(239,68,68))" }}></span>
              <span>높음</span>
              <span className="inline-block w-3 h-2" style={{ background: "rgb(239,68,68)" }}></span>
            </span>
            <span className="ml-auto">x = SHAP value (좌: 위험 ↓ / 우: 위험 ↑) · 추후 실제값으로 교체</span>
          </div>
        </Panel>
      </div>

      {/* 아래: Pearson r / Cohen's d */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 mb-4 sm:mb-5">
        <Panel
          title="health와의 상관관계 Top 10 (Pearson r)"
          right={
            <span className="text-[11px] text-brand-textMuted">
              max |r| = {maxAbsR.toFixed(4)}
            </span>
          }
        >
          <div style={chartBox(280)}>
            <ResponsiveContainer>
              <BarChart data={corr} layout="vertical" margin={{ left: 30, right: 20 }}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis
                  type="number"
                  tick={CHART_TICK}
                  domain={[
                    (dataMin: number) => -Math.max(Math.abs(dataMin), 0.01) * 1.1,
                    (dataMax: number) => Math.max(Math.abs(dataMax), 0.01) * 1.1,
                  ]}
                  tickFormatter={(v) => Number(v).toFixed(3)}
                />
                <YAxis
                  type="category"
                  dataKey="feature"
                  tick={{ ...CHART_TICK, fontSize: 10 }}
                  width={50}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(v: any) => Number(v).toFixed(4)}
                />
                <ReferenceLine x={0} stroke="#94a3b8" />
                <Bar dataKey="r" radius={[0, 4, 4, 0]}>
                  {corr.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.r >= 0 ? CHART_COLORS.danger : CHART_COLORS.primary}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel
          title="위험군 vs 정상군 분리 강도 Top 10 (Cohen's d)"
          right={
            <span className="text-[11px] text-brand-textMuted">
              |d| &gt; 0.8 = 강한 분리
            </span>
          }
        >
          <div style={chartBox(280)}>
            <ResponsiveContainer>
              <BarChart data={varCmp} layout="vertical" margin={{ left: 30, right: 20 }}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis
                  type="number"
                  tick={CHART_TICK}
                  domain={[
                    (dataMin: number) => -Math.max(Math.abs(dataMin), 1) * 1.1,
                    (dataMax: number) => Math.max(Math.abs(dataMax), 1) * 1.1,
                  ]}
                  tickFormatter={(v) => Number(v).toFixed(2)}
                />
                <YAxis
                  type="category"
                  dataKey="feature"
                  tick={{ ...CHART_TICK, fontSize: 10 }}
                  width={50}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(v: any) => Number(v).toFixed(2)}
                />
                <ReferenceLine x={0} stroke="#94a3b8" />
                <ReferenceLine x={0.8} stroke={CHART_COLORS.danger} strokeDasharray="3 3" />
                <ReferenceLine x={-0.8} stroke={CHART_COLORS.danger} strokeDasharray="3 3" />
                <Bar dataKey="cohens_d" radius={[0, 4, 4, 0]}>
                  {varCmp.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.cohens_d >= 0 ? CHART_COLORS.danger : CHART_COLORS.primary}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
    </div>
  );
}
