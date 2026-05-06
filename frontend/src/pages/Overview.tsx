/**
 * Overview — PI 운영 페이지.
 *
 * 상단에 "오늘 검사" 강조 카드 + 일반 KPI 3개 + 위험 lot alert + 시계열 + Top + 분포.
 * Status 필터 default: today.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchGlobalAnomalyFeatures,
  fetchLots,
  fetchOverview,
  fetchTriage,
  fetchUnits,
  type StatusFilter,
  type UnitItem,
} from "../lib/api";
import KpiCard from "../components/KpiCard";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";
import StatChip from "../components/StatChip";
import { fmtInt, fmtNum, fmtPct, fmtPpm, healthToPpm, TIERS, tierOfHealth } from "../lib/format";
import {
  BAR_RADIUS,
  CHART_COLORS,
  CHART_GRID,
  CHART_LEGEND_STYLE,
  CHART_TICK,
  CHART_TOOLTIP_STYLE,
  chartBox,
} from "../lib/chart";

type Granularity = "day" | "week";

// 시계열 범위는 status에 따라 동적: completed=과거30, pending=미래30, all=61(과거30+오늘+미래30), today=비활성
const COMPLETED_DAYS = 30;
const PENDING_DAYS = 30;
const WEEK_DAYS = 7;

function downloadCsv(rows: UnitItem[], filename: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => String((r as any)[h] ?? "")).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 오늘 자정 기준 Date — 시간 부분 제거해야 daysBack 계산이 안전 */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** status별 시계열 범위 산정 — daysFromToday: 음수=과거, 0=오늘, 양수=미래 */
function trendRange(status: StatusFilter): { dayStart: number; dayEnd: number } {
  // dayStart/dayEnd는 today 기준 offset (포함). all = -30 ~ +30, completed = -30 ~ -1, pending = +1 ~ +30
  if (status === "completed") return { dayStart: -COMPLETED_DAYS, dayEnd: -1 };
  if (status === "pending") return { dayStart: 1, dayEnd: PENDING_DAYS };
  // "today"는 시계열 비활성이지만 fallback으로 오늘만 표시
  if (status === "today") return { dayStart: 0, dayEnd: 0 };
  return { dayStart: -COMPLETED_DAYS, dayEnd: PENDING_DAYS }; // all
}

function bucketLabel(g: Granularity, binIdx: number, dayStart: number): string {
  // binIdx=0이 dayStart에 해당, 양수 방향으로 진행
  const step = g === "day" ? 1 : WEEK_DAYS;
  const d = startOfToday();
  d.setDate(d.getDate() + dayStart + binIdx * step);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

interface TrendBucket {
  label: string;
  completedCount: number;
  pendingCount: number;
  todayCount: number;
  totalCount: number;
  /** 평균 pred를 ppm 단위로 (pred * 1e6) */
  meanPredPpm: number;
}

function buildTrend(units: UnitItem[], g: Granularity, status: StatusFilter): TrendBucket[] {
  const { dayStart, dayEnd } = trendRange(status);
  const step = g === "day" ? 1 : WEEK_DAYS;
  const totalDays = dayEnd - dayStart + 1;
  const nBins = Math.max(1, Math.ceil(totalDays / step));
  const today = startOfToday().getTime();
  const arr: TrendBucket[] = Array.from({ length: nBins }, (_, i) => ({
    label: bucketLabel(g, i, dayStart),
    completedCount: 0,
    pendingCount: 0,
    todayCount: 0,
    totalCount: 0,
    meanPredPpm: 0,
  }));
  const predSum = new Array(nBins).fill(0);
  for (const u of units) {
    if (!u.inspected_date) continue;
    const insp = new Date(u.inspected_date);
    insp.setHours(0, 0, 0, 0);
    const daysFromToday = Math.floor((insp.getTime() - today) / 86_400_000);
    if (daysFromToday < dayStart || daysFromToday > dayEnd) continue;
    const b = Math.floor((daysFromToday - dayStart) / step);
    if (b < 0 || b >= nBins) continue;
    arr[b].totalCount += 1;
    if (u.status === "completed") arr[b].completedCount += 1;
    else if (u.status === "today") arr[b].todayCount += 1;
    else arr[b].pendingCount += 1;
    predSum[b] += u.pred;
  }
  for (let i = 0; i < nBins; i++) {
    arr[i].meanPredPpm =
      arr[i].totalCount > 0 ? (predSum[i] / arr[i].totalCount) * 1_000_000 : 0;
  }
  return arr;
}

/* ─── 오늘 모드: 어제 비교 ─────────────────── */
interface DayCompare {
  count: number;
  meanPredPpm: number;
  riskCount: number;
}

/** 오늘 vs 어제 비교 (count, 평균 ppm, 위험 unit 수) */
function buildDayCompare(units: UnitItem[]): { today: DayCompare; yesterday: DayCompare } {
  const todayMs = startOfToday().getTime();
  const yesterdayMs = todayMs - 86_400_000;
  const empty = (): DayCompare => ({ count: 0, meanPredPpm: 0, riskCount: 0 });
  const todayAgg = empty();
  const yesterdayAgg = empty();
  let todaySum = 0;
  let yesterdaySum = 0;
  for (const u of units) {
    if (!u.inspected_date) continue;
    const insp = new Date(u.inspected_date);
    insp.setHours(0, 0, 0, 0);
    const t = insp.getTime();
    if (t === todayMs) {
      todayAgg.count += 1;
      todaySum += u.pred;
      if (u.is_risk) todayAgg.riskCount += 1;
    } else if (t === yesterdayMs) {
      yesterdayAgg.count += 1;
      yesterdaySum += u.pred;
      if (u.is_risk) yesterdayAgg.riskCount += 1;
    }
  }
  todayAgg.meanPredPpm = todayAgg.count > 0 ? (todaySum / todayAgg.count) * 1_000_000 : 0;
  yesterdayAgg.meanPredPpm = yesterdayAgg.count > 0 ? (yesterdaySum / yesterdayAgg.count) * 1_000_000 : 0;
  return { today: todayAgg, yesterday: yesterdayAgg };
}

/* ─── 분포 차트: ppm log-scale (zero spike 분리) ──────────────
 * health=0 (정상)은 별도 카운트로 분리하고, ppm > 0인 unit만
 * log10(ppm) 기준 bin에 분배. zero가 70% 이상이라 같은 축에 두면 압도됨.
 */
interface PpmBucket {
  /** bin 라벨 (예: "1~10 ppm") */
  range: string;
  count: number;
  /** bin 중심 ppm (정렬용) */
  rangeStart: number;
}
function buildPpmHist(units: UnitItem[]): { zero: number; bins: PpmBucket[] } {
  // 실제 pred ppm 범위(0~4,140)에 맞춘 500ppm 균등 bin
  const decades = [
    { from: 0, to: 500, label: "<500 ppm" },
    { from: 500, to: 1_000, label: "500~1k ppm" },
    { from: 1_000, to: 1_500, label: "1k~1.5k ppm" },
    { from: 1_500, to: 2_000, label: "1.5k~2k ppm" },
    { from: 2_000, to: 2_500, label: "2k~2.5k ppm" },
    { from: 2_500, to: 3_000, label: "2.5k~3k ppm" },
    { from: 3_000, to: 3_500, label: "3k~3.5k ppm" },
    { from: 3_500, to: 4_000, label: "3.5k~4k ppm" },
    { from: 4_000, to: Infinity, label: "4k+ ppm" },
  ];
  const counts = new Array(decades.length).fill(0);
  let zero = 0;
  for (const u of units) {
    const ppm = Math.max(0, u.pred) * 1_000_000;
    if (ppm <= 0) {
      zero += 1;
      continue;
    }
    const idx = decades.findIndex((d) => ppm >= d.from && ppm < d.to);
    counts[idx >= 0 ? idx : decades.length - 1] += 1;
  }
  return {
    zero,
    bins: decades.map((d, i) => ({
      range: d.label,
      rangeStart: d.from,
      count: counts[i],
    })),
  };
}

/* ─── Tier(S/A/B/C/D) 분포 ─────────────────────────────────── */
interface TierCount {
  tier: string;
  count: number;
  ratio: number;
  color: string;
}
function buildTierDist(units: UnitItem[]): TierCount[] {
  const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const u of units) counts[tierOfHealth(u.pred)] += 1;
  const total = units.length || 1;
  return TIERS.map((t) => ({
    tier: t.tier,
    count: counts[t.tier] ?? 0,
    ratio: (counts[t.tier] ?? 0) / total,
    color: t.color,
  }));
}

/* ─── 스크리닝 시뮬레이션 ──────────────────────────────────
 * 임계 ppm 이상 unit을 차단했을 때 통과 fleet의 평균 ppm 변화 등.
 */
interface ScreenSim {
  blocked: number;
  passed: number;
  blockRatio: number;
  meanPpmAll: number;
  meanPpmPassed: number;
  ppmReduction: number;
}
function simulateScreening(units: UnitItem[], thresholdPpm: number): ScreenSim {
  if (units.length === 0) {
    return {
      blocked: 0,
      passed: 0,
      blockRatio: 0,
      meanPpmAll: 0,
      meanPpmPassed: 0,
      ppmReduction: 0,
    };
  }
  const ppms = units.map((u) => Math.max(0, u.pred) * 1_000_000);
  const meanAll = ppms.reduce((a, b) => a + b, 0) / ppms.length;
  const passed = ppms.filter((p) => p <= thresholdPpm);
  const meanPassed =
    passed.length > 0 ? passed.reduce((a, b) => a + b, 0) / passed.length : 0;
  const blocked = ppms.length - passed.length;
  return {
    blocked,
    passed: passed.length,
    blockRatio: blocked / ppms.length,
    meanPpmAll: meanAll,
    meanPpmPassed: meanPassed,
    ppmReduction: meanAll - meanPassed,
  };
}

export default function Overview() {
  const [status, setStatus] = useState<StatusFilter>("today");
  const [granularity, setGranularity] = useState<Granularity>("day");
  // 시계열 막대 클릭 시 그 날짜의 상세를 모달로 표시
  const [selectedDateLabel, setSelectedDateLabel] = useState<string | null>(null);

  const overviewQ = useQuery({ queryKey: ["overview"], queryFn: fetchOverview });
  const triageQ = useQuery({
    queryKey: ["triage", status],
    queryFn: () => fetchTriage({ status, top_units: 10, top_wafers: 10 }),
  });
  const allUnitsQ = useQuery({
    queryKey: ["units-all"],
    queryFn: () => fetchUnits({ page: 1, page_size: 50_000 }),
  });
  const lotsQ = useQuery({
    queryKey: ["alert-lots", status],
    queryFn: () => fetchLots({ status, sort: "risk_ratio", limit: 5 }),
  });
  const globalAnomalyQ = useQuery({
    queryKey: ["overview-global-anomaly", status],
    queryFn: () => fetchGlobalAnomalyFeatures({ status, top_n: 10 }),
  });

  // 스크리닝 시뮬레이터 임계값 (ppm). 실제 pred 분포 0~4,140 기준 p75(3,200)
  const [screenThresholdPpm, setScreenThresholdPpm] = useState(3_200);

  const filteredUnits = useMemo(() => {
    if (!allUnitsQ.data) return [];
    return status === "all"
      ? allUnitsQ.data.items
      : allUnitsQ.data.items.filter((u) => u.status === status);
  }, [allUnitsQ.data, status]);

  const trend = useMemo(
    () => (allUnitsQ.data ? buildTrend(allUnitsQ.data.items, granularity, status) : []),
    [allUnitsQ.data, granularity, status]
  );
  // 오늘 unit 중 평균 pred 가장 높은 lot / wafer 산출 (요약 문장용)
  const todayTop = useMemo(() => {
    if (!allUnitsQ.data) return { topLot: null as string | null, topWafer: null as string | null };
    const todayMs = startOfToday().getTime();
    const lotAgg = new Map<string, { sum: number; n: number }>();
    const waferAgg = new Map<string, { sum: number; n: number }>();
    for (const u of allUnitsQ.data.items) {
      if (u.status !== "today" || !u.inspected_date) continue;
      const insp = new Date(u.inspected_date);
      insp.setHours(0, 0, 0, 0);
      if (insp.getTime() !== todayMs) continue;
      const l = lotAgg.get(u.run_id) ?? { sum: 0, n: 0 };
      l.sum += u.pred; l.n += 1;
      lotAgg.set(u.run_id, l);
      const w = waferAgg.get(u.wafer_key) ?? { sum: 0, n: 0 };
      w.sum += u.pred; w.n += 1;
      waferAgg.set(u.wafer_key, w);
    }
    const pickTop = (m: Map<string, { sum: number; n: number }>) => {
      let best: string | null = null;
      let bestMean = -Infinity;
      for (const [k, v] of m) {
        const mean = v.sum / v.n;
        if (mean > bestMean) { bestMean = mean; best = k; }
      }
      return best;
    };
    return { topLot: pickTop(lotAgg), topWafer: pickTop(waferAgg) };
  }, [allUnitsQ.data]);

  const dayCompare = useMemo(
    () => (allUnitsQ.data ? buildDayCompare(allUnitsQ.data.items) : { today: { count: 0, meanPredPpm: 0, riskCount: 0 }, yesterday: { count: 0, meanPredPpm: 0, riskCount: 0 } }),
    [allUnitsQ.data]
  );
  const ppmHist = useMemo(() => buildPpmHist(filteredUnits), [filteredUnits]);
  const tierDist = useMemo(() => buildTierDist(filteredUnits), [filteredUnits]);
  const screenSim = useMemo(
    () => simulateScreening(filteredUnits, screenThresholdPpm),
    [filteredUnits, screenThresholdPpm]
  );

  if (triageQ.isLoading || overviewQ.isLoading)
    return <div className="text-[12px] text-brand-textMuted p-2">로딩 중…</div>;
  if (triageQ.error || !triageQ.data || !overviewQ.data)
    return (
      <div className="panel p-3 text-[12px] text-brand-danger">
        API 연결 실패. 서버를 확인하세요.
      </div>
    );

  const todayStats = overviewQ.data.statuses.today;
  const t = triageQ.data.summary;
  const meanPred = (() => {
    if (status === "all") {
      const arr = Object.values(overviewQ.data.statuses);
      const total = arr.reduce((a, s) => a + s.n_units, 0);
      return total > 0 ? arr.reduce((a, s) => a + s.pred_mean * s.n_units, 0) / total : 0;
    }
    return overviewQ.data.statuses[status]?.pred_mean ?? 0;
  })();
  const baseline = lotsQ.data?.baseline_risk_ratio ?? t.risk_ratio;
  const dangerLots = (lotsQ.data?.items ?? []).filter((l) => l.risk_ratio > baseline * 1.5);

  return (
    <div>
      <PageHeader
        title="Overview"
        status={status}
        onStatusChange={setStatus}
      />

      {/* KPI 4종 — 어제 대비 증감 chip 포함 (dayCompare 기반) */}
      {(() => {
        const buildChange = (today: number, yesterday: number) => {
          if (yesterday === 0 && today === 0) return undefined;
          const diff = today - yesterday;
          const pct = yesterday > 0 ? (diff / yesterday) * 100 : null;
          const direction: "up" | "down" | "flat" = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
          const label =
            pct === null
              ? `어제 ${fmtInt(yesterday)}`
              : `어제 대비 ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
          return { label, direction, higherIsBad: true };
        };
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-5">
            <KpiCard
              label="오늘 검사 unit"
              value={fmtInt(dayCompare.today.count)}
              hint="실시간 진단 대상"
              tone="warn"
              accentBar="#f59e0b"
              change={(() => {
                const c = buildChange(dayCompare.today.count, dayCompare.yesterday.count);
                return c ? { ...c, higherIsBad: false } : undefined; // 검사량 증가는 좋음
              })()}
            />
            <KpiCard
              label="오늘 평균 예측 ppm"
              value={fmtPpm(dayCompare.today.meanPredPpm)}
              hint="오늘 검사 unit 평균"
              tone="info"
              change={buildChange(dayCompare.today.meanPredPpm, dayCompare.yesterday.meanPredPpm)}
            />
            <KpiCard
              label="p95 ppm"
              value={fmtPpm(healthToPpm(triageQ.data.scale.risk_threshold))}
              hint="상위 5% 꼬리 위험 수준"
              tone="warn"
            />
            <KpiCard
              label="오늘 위험 unit"
              value={fmtInt(dayCompare.today.riskCount)}
              hint={`pred > p95 (오늘 ${fmtInt(dayCompare.today.count)} 중)`}
              tone="danger"
              change={buildChange(dayCompare.today.riskCount, dayCompare.yesterday.riskCount)}
            />
          </div>
        );
      })()}

      {/* 오늘 자연어 요약 — 한눈에 상황 파악 */}
      {dayCompare.today.count > 0 && (() => {
        const thresholdRate = dayCompare.today.count > 0
          ? (dayCompare.today.riskCount / dayCompare.today.count) * 100
          : 0;
        return (
          <div className="mb-4 sm:mb-5 bg-blue-50 border-l-4 border-brand-primary rounded-md px-4 py-3">
            <div className="text-[12px] text-brand-text leading-relaxed">
              오늘 검사된 <strong className="text-brand-primary">{fmtInt(dayCompare.today.count)}</strong>개 Unit 중{" "}
              <strong className="text-brand-danger">{thresholdRate.toFixed(1)}%</strong>가 임계값을 초과했습니다.
              {(todayTop.topLot || todayTop.topWafer) && (
                <>
                  {" "}위험도는{" "}
                  {todayTop.topLot && <strong className="font-mono">{todayTop.topLot}</strong>}
                  {todayTop.topLot && " Lot, "}
                  {todayTop.topWafer && <strong className="font-mono">{todayTop.topWafer}</strong>}
                  {todayTop.topWafer && " Wafer"}
                  에서 상대적으로 높게 나타났으며, 상위 위험 Unit을 우선 확인할 필요가 있습니다.
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Alert 영역 */}
      {dangerLots.length > 0 && (
        <Panel title="위험 lot 알림" className="mb-4 sm:mb-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-brand-textMuted">
              평균 위험률 {fmtPct(baseline)} 대비 1.5배 이상:
            </span>
            {dangerLots.map((l) => (
              <Link
                key={l.run_id}
                to={`/drilldown`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 text-[11px] font-semibold hover:bg-amber-100 transition-colors"
                title={`위험 ${l.n_risk}/${l.n_units} unit · 전체 모집단 ${l.n_units}`}
              >
                <span className="font-mono">{l.run_id}</span>
                <span className="tabular">{fmtPct(l.risk_ratio)}</span>
                <span className="tabular text-amber-600 font-normal">({l.n_risk}/{l.n_units})</span>
              </Link>
            ))}
          </div>
        </Panel>
      )}

      {/* 메인 시계열 — today 모드에서는 표시 안 함 (하루치라 의미 없음) */}
      {status !== "today" && (
        <Panel
          title="기간별 처리량 & 평균 pred (ppm)"
          right={
            <div className="flex items-center gap-2 flex-wrap">
              <span className="chip chip-tbd" title="Mann-Kendall 추세 검정 미연결">
                <span aria-hidden>⚠</span>
                <span>추세 검정 — TBD</span>
              </span>
              <div className="inline-flex bg-brand-subtle rounded-md overflow-hidden">
                {(["day", "week"] as Granularity[]).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    className={`text-[11px] px-2.5 py-1 font-medium transition-colors ${
                      granularity === g
                        ? "bg-brand-primary text-white"
                        : "text-brand-textMuted hover:text-brand-text"
                    }`}
                  >
                    {g === "day" ? "일별" : "주별"}
                  </button>
                ))}
              </div>
            </div>
          }
          className="mb-4 sm:mb-5"
        >
          <div style={chartBox(240)}>
            <ResponsiveContainer>
              <BarChart data={trend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis
                  dataKey="label"
                  tick={CHART_TICK}
                  interval={granularity === "day" ? 3 : 0}
                />
                <YAxis
                  tick={CHART_TICK}
                  tickFormatter={(v) => `${Math.round(v).toLocaleString()}`}
                  label={{
                    value: "ppm",
                    angle: -90,
                    position: "insideLeft",
                    fontSize: 11,
                    fill: "#64748b",
                  }}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(value: any, _name: any, props: any) => {
                    const ppm = `${Math.round(Number(value)).toLocaleString()} ppm`;
                    const total = props?.payload?.totalCount ?? 0;
                    return [`${ppm} · 검사 ${total.toLocaleString()}개`, "평균 pred"];
                  }}
                />
                <Legend wrapperStyle={CHART_LEGEND_STYLE} />
                <Bar
                  dataKey="meanPredPpm"
                  fill={CHART_COLORS.primary}
                  name="평균 pred (ppm)"
                  radius={BAR_RADIUS}
                  cursor="pointer"
                  onClick={(d: any) => setSelectedDateLabel(d?.label ?? null)}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      {/* 글로벌 비정상 변수 — 현재 status의 위험 unit이 정상 baseline 대비 가장 벗어난 변수 Top 10 */}
      {globalAnomalyQ.data && globalAnomalyQ.data.items.length > 0 && (
        <Panel
          title="위험 unit이 정상 대비 벗어난 변수 Top 10"
          right={
            <span className="text-[10px] text-brand-textMuted">
              위험 unit {fmtInt(globalAnomalyQ.data.n_risk_units)}개 평균 vs 정상 unit 평균 ·
              z = |Δ| / 정상 std
            </span>
          }
          className="mb-4 sm:mb-5"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {globalAnomalyQ.data.items.map((it) => {
              const minV = Math.min(it.normal_mean, it.risk_mean);
              const maxV = Math.max(it.normal_mean, it.risk_mean);
              const range = Math.max(Math.abs(maxV - minV), Math.abs(maxV) * 0.1, 1e-9);
              const axisMin = minV - range * 0.15;
              const axisMax = maxV + range * 0.15;
              const span = axisMax - axisMin || 1;
              const normalLen = ((it.normal_mean - axisMin) / span) * 100;
              const riskLen = ((it.risk_mean - axisMin) / span) * 100;
              const isHigher = it.risk_mean > it.normal_mean;
              const zSeverity =
                it.z_score >= 3 ? "text-brand-danger" : it.z_score >= 2 ? "text-brand-warn" : "text-brand-textMuted";
              return (
                <div key={it.feature} className="border border-brand-border rounded-md p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[12px] font-semibold text-brand-text">{it.feature}</span>
                      <span className={`text-[11px] font-bold ${zSeverity}`}>z={it.z_score.toFixed(2)}</span>
                    </div>
                    <span className="text-[10px] text-brand-textMuted">
                      {isHigher ? "▲ 위험군이 더 높음" : "▼ 위험군이 더 낮음"}
                    </span>
                  </div>
                  {/* 정상 평균 막대 */}
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] text-brand-textMuted w-10 shrink-0">정상</span>
                    <div className="flex-1 h-3.5 bg-brand-subtle rounded-sm relative">
                      <div
                        className="absolute top-0 bottom-0 left-0 bg-emerald-500 rounded-sm"
                        style={{ width: `${normalLen}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-brand-textMuted tabular w-14 shrink-0 text-right">
                      {fmtNum(it.normal_mean, 2)}
                    </span>
                  </div>
                  {/* 위험 unit 평균 막대 */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-brand-text font-semibold w-10 shrink-0">위험</span>
                    <div className="flex-1 h-3.5 bg-brand-subtle rounded-sm relative">
                      <div
                        className={`absolute top-0 bottom-0 left-0 rounded-sm ${isHigher ? "bg-brand-danger" : "bg-brand-primary"}`}
                        style={{ width: `${riskLen}%` }}
                      />
                    </div>
                    <span className={`text-[10px] tabular w-14 shrink-0 text-right font-semibold ${isHigher ? "text-brand-danger" : "text-brand-primary"}`}>
                      {fmtNum(it.risk_mean, 2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Top 위험 + 분포 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 mb-4 sm:mb-5">
        <Panel
          title="위험 wafer Top 10"
          right={
            <Link to="/drilldown" className="text-[11px] text-brand-link hover:underline">
              자세히 →
            </Link>
          }
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="spotfire">
              <thead>
                <tr>
                  <th>Wafer</th>
                  <th className="text-right">Units</th>
                  <th className="text-right">위험</th>
                  <th className="text-right">비율</th>
                </tr>
              </thead>
              <tbody>
                {triageQ.data.top_wafers.slice(0, 10).map((w) => (
                  <tr key={w.wafer_key}>
                    <td>
                      <Link
                        to={`/drilldown?key=${encodeURIComponent(w.wafer_key)}`}
                        className="text-brand-link hover:underline font-mono"
                      >
                        {w.wafer_key}
                      </Link>
                    </td>
                    <td className="text-right tabular">{fmtInt(w.n_units)}</td>
                    <td className="text-right tabular text-brand-danger font-semibold">
                      {fmtInt(w.n_risk)}
                    </td>
                    <td className="text-right tabular font-bold">{fmtPct(w.risk_ratio)}</td>
                  </tr>
                ))}
                {triageQ.data.top_wafers.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-brand-textMuted p-3">
                    데이터 없음
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="위험 unit Top 10"
          right={
            <button
              onClick={() => downloadCsv(triageQ.data.top_units, `risk_units_${status}.csv`)}
              className="btn btn-primary text-[10px]"
              disabled={triageQ.data.top_units.length === 0}
            >
              ↓ CSV
            </button>
          }
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="spotfire">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th className="text-right">예측 ppm</th>
                  <th>Wafer</th>
                </tr>
              </thead>
              <tbody>
                {triageQ.data.top_units.slice(0, 10).map((u) => (
                  <tr key={u.ufs_serial}>
                    <td className="font-mono">{u.ufs_serial}</td>
                    <td className="text-right tabular font-mono font-bold text-brand-danger">
                      {fmtPpm(healthToPpm(u.pred))}
                    </td>
                    <td>
                      <Link
                        to={`/drilldown?key=${u.wafer_key}`}
                        className="text-brand-link hover:underline font-mono"
                      >
                        {u.wafer_key}
                      </Link>
                    </td>
                  </tr>
                ))}
                {triageQ.data.top_units.length === 0 && (
                  <tr><td colSpan={3} className="text-center text-brand-textMuted p-3">
                    데이터 없음
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* Tier 분포 + 스크리닝 시뮬레이터 — 회귀 결과의 운영 의사결정 도구 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 mb-4 sm:mb-5">
        {/* Tier 등급 분포 */}
        <Panel title="Tier 등급 분포 (S/A/B/C/D)">
          <div className="space-y-2">
            <div className="flex w-full h-7 rounded-md overflow-hidden border border-brand-border/60">
              {tierDist.map((td) =>
                td.count === 0 ? null : (
                  <div
                    key={td.tier}
                    style={{ background: td.color, width: `${td.ratio * 100}%` }}
                    className="text-[10px] text-white font-semibold flex items-center justify-center"
                    title={`${td.tier}: ${td.count.toLocaleString()} (${(td.ratio * 100).toFixed(1)}%)`}
                  >
                    {td.ratio > 0.04 ? td.tier : ""}
                  </div>
                ),
              )}
            </div>
            <table className="w-full text-[11px]">
              <tbody>
                {TIERS.map((tdef, i) => {
                  const td = tierDist[i];
                  return (
                    <tr key={tdef.tier} className="border-b border-brand-border/40 last:border-0">
                      <td className="py-1 pr-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-sm align-middle mr-1.5"
                          style={{ background: tdef.color }}
                        />
                        <span className="font-semibold">{tdef.tier}</span>
                        <span className="text-brand-textMuted ml-1">({tdef.desc})</span>
                      </td>
                      <td className="py-1 text-right tabular">{fmtInt(td?.count ?? 0)}</td>
                      <td className="py-1 text-right tabular text-brand-textMuted w-12">
                        {fmtPct(td?.ratio ?? 0, 1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="text-[10px] text-brand-textMuted px-1">
              * 등급은 의사결정용 그루핑 — 모델은 연속 ppm을 예측하며, 임계값은 운영 기준이지 모델 출력이 아님.
            </div>
          </div>
        </Panel>

        {/* 스크리닝 시뮬레이터 */}
        <Panel
          title="스크리닝 시뮬레이터"
          right={
            <span className="text-[11px] text-brand-textMuted">
              임계 초과 unit을 출하 차단했을 때 fleet 품질 변화
            </span>
          }
        >
          <div className="space-y-3">
            <div>
              <div className="flex justify-between items-baseline mb-1">
                <label className="text-[11px] font-medium text-brand-text">
                  차단 임계 ppm
                </label>
                <span className="tabular text-[14px] font-bold text-brand-primary">
                  {fmtPpm(screenThresholdPpm)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={4_500}
                step={50}
                value={screenThresholdPpm}
                onChange={(e) => setScreenThresholdPpm(Number(e.target.value))}
                className="w-full accent-brand-primary"
              />
              <div className="flex justify-between text-[10px] text-brand-textMuted mt-0.5">
                <span>0</span>
                <span>1.5k</span>
                <span>3k</span>
                <span>4.5k ppm</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="bg-brand-subtle rounded-md p-2">
                <div className="text-brand-textMuted">차단율</div>
                <div className="tabular text-[16px] font-bold text-brand-warn">
                  {fmtPct(screenSim.blockRatio, 2)}
                </div>
                <div className="text-[10px] text-brand-textMuted">
                  {fmtInt(screenSim.blocked)} / {fmtInt(filteredUnits.length)} unit
                </div>
              </div>
              <div className="bg-brand-subtle rounded-md p-2">
                <div className="text-brand-textMuted">통과 fleet 평균 ppm</div>
                <div className="tabular text-[16px] font-bold text-brand-primary">
                  {fmtPpm(screenSim.meanPpmPassed)}
                </div>
                <div className="text-[10px] text-brand-textMuted">
                  차단 전: {fmtPpm(screenSim.meanPpmAll)}
                </div>
              </div>
              <div className="bg-emerald-50 rounded-md p-2 col-span-2">
                <div className="text-brand-textMuted">ppm 감소량 (스크리닝 효과)</div>
                <div className="tabular text-[18px] font-bold text-emerald-600">
                  {fmtPpm(screenSim.ppmReduction)} ↓
                </div>
                <div className="tbd-block mt-1.5">
                  <span className="font-semibold">⚠ Field 영향 환산 — TBD:</span>{" "}
                  사용자 수 × 일 동작 횟수 가정값이 아직 미연결.
                  운영 가정이 정해지면 "ppm 감소량 × N"으로 하루 field error 감소량 표시 예정.
                </div>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* 시계열 막대 클릭 시 그 날짜 상세 모달 */}
      {selectedDateLabel && allUnitsQ.data && (() => {
        // 선택된 라벨(예: "5/4")과 일치하는 unit 추출
        const matched = allUnitsQ.data.items.filter((u) => {
          if (!u.inspected_date) return false;
          const d = new Date(u.inspected_date);
          return `${d.getMonth() + 1}/${d.getDate()}` === selectedDateLabel;
        });
        const meanPpm = matched.length > 0
          ? (matched.reduce((a, u) => a + u.pred, 0) / matched.length) * 1_000_000
          : 0;
        const nRisk = matched.filter((u) => u.is_risk).length;
        const top10 = [...matched].sort((a, b) => b.pred - a.pred).slice(0, 10);
        return (
          <div
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
            onClick={() => setSelectedDateLabel(null)}
          >
            <div
              className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[15px] font-bold text-brand-text">{selectedDateLabel} 상세</h3>
                <button
                  className="text-brand-textMuted hover:text-brand-text text-[18px]"
                  onClick={() => setSelectedDateLabel(null)}
                >
                  ×
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-brand-subtle rounded-md p-2">
                  <div className="text-[10px] text-brand-textMuted">검사 unit</div>
                  <div className="tabular text-[16px] font-bold">{fmtInt(matched.length)}</div>
                </div>
                <div className="bg-brand-subtle rounded-md p-2">
                  <div className="text-[10px] text-brand-textMuted">평균 pred</div>
                  <div className="tabular text-[16px] font-bold">{Math.round(meanPpm).toLocaleString()} ppm</div>
                </div>
                <div className="bg-brand-subtle rounded-md p-2">
                  <div className="text-[10px] text-brand-textMuted">위험 unit</div>
                  <div className="tabular text-[16px] font-bold text-brand-danger">{fmtInt(nRisk)}</div>
                </div>
              </div>
              <div className="text-[11px] font-semibold mb-2">위험 Top 10</div>
              <table className="w-full text-[11px]">
                <thead className="text-brand-textMuted border-b border-brand-border">
                  <tr>
                    <th className="text-left py-1">unit</th>
                    <th className="text-left py-1">wafer</th>
                    <th className="text-right py-1">pred (ppm)</th>
                    <th className="text-right py-1">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {top10.map((u) => (
                    <tr key={u.ufs_serial} className="border-b border-brand-border/40">
                      <td className="font-mono py-1">{u.ufs_serial}</td>
                      <td className="font-mono py-1 text-brand-textMuted">{u.wafer_key}</td>
                      <td className="text-right tabular py-1">{Math.round(u.pred * 1_000_000).toLocaleString()}</td>
                      <td className="text-right py-1">
                        {u.is_risk ? <span className="text-brand-danger font-semibold">위험</span> : <span className="text-brand-textMuted">·</span>}
                      </td>
                    </tr>
                  ))}
                  {top10.length === 0 && (
                    <tr><td colSpan={4} className="text-center py-3 text-brand-textMuted">해당 날짜 unit 없음</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
