/**
 * Overview — PI 운영 페이지.
 *
 * 상단에 "오늘 검사" 강조 카드 + 일반 KPI 3개 + 위험 lot alert + 시계열 + Top + 분포.
 * Status 필터 default: today.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchLots,
  fetchOverview,
  fetchTriage,
  fetchUnits,
  type StatusFilter,
  type UnitItem,
} from "../lib/api";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";
import { fmtInt, fmtPpm, healthToPpm, TIERS, tierOfHealth } from "../lib/format";
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

/** 최근 7일 (today-6 ~ today) 일별 평균 ppm 버킷 — KPI 직하 차트용 */
function buildTrend7d(units: UnitItem[]): { label: string; date: string; meanPredPpm: number; totalCount: number; isToday: boolean }[] {
  const todayMs = startOfToday().getTime();
  const day = 86_400_000;
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const buckets = Array.from({ length: 7 }, (_, i) => {
    const offset = i - 6; // -6, -5, ..., 0
    const t = todayMs + offset * day;
    const d = new Date(t);
    return {
      ms: t,
      iso: d.toISOString().slice(0, 10),
      label: `${d.getMonth() + 1}/${d.getDate()} (${dayNames[d.getDay()]})`,
      meanPredPpm: 0,
      totalCount: 0,
      sum: 0,
      isToday: offset === 0,
    };
  });
  for (const u of units) {
    if (!u.inspected_date) continue;
    const insp = new Date(u.inspected_date);
    insp.setHours(0, 0, 0, 0);
    const t = insp.getTime();
    const offset = Math.round((t - todayMs) / day);
    if (offset < -6 || offset > 0) continue;
    const idx = offset + 6;
    buckets[idx].totalCount += 1;
    buckets[idx].sum += u.pred;
  }
  return buckets.map((b) => ({
    label: b.label,
    date: b.iso,
    meanPredPpm: b.totalCount > 0 ? (b.sum / b.totalCount) * 1_000_000 : 0,
    totalCount: b.totalCount,
    isToday: b.isToday,
  }));
}

/* ─── 오늘 모드: 어제 비교 ─────────────────── */
interface DayCompare {
  count: number;
  meanPredPpm: number;
  riskCount: number;
}

interface WeekCompare {
  thisWeek: { count: number; meanPredPpm: number };
  lastWeek: { count: number; meanPredPpm: number };
}

/** 이번주(오늘 포함 최근 7일) vs 지난주(그 직전 7일) 평균 ppm 비교 */
function buildWeekCompare(units: UnitItem[]): WeekCompare {
  const todayMs = startOfToday().getTime();
  const day = 86_400_000;
  // 이번주 = today-6 ~ today (7일)
  // 지난주 = today-13 ~ today-7 (7일)
  const thisStart = todayMs - 6 * day;
  const lastStart = todayMs - 13 * day;
  const lastEnd = todayMs - 7 * day;
  let tCount = 0, tSum = 0, lCount = 0, lSum = 0;
  for (const u of units) {
    if (!u.inspected_date) continue;
    const insp = new Date(u.inspected_date);
    insp.setHours(0, 0, 0, 0);
    const t = insp.getTime();
    if (t >= thisStart && t <= todayMs) {
      tCount += 1;
      tSum += u.pred;
    } else if (t >= lastStart && t <= lastEnd) {
      lCount += 1;
      lSum += u.pred;
    }
  }
  return {
    thisWeek: { count: tCount, meanPredPpm: tCount > 0 ? (tSum / tCount) * 1_000_000 : 0 },
    lastWeek: { count: lCount, meanPredPpm: lCount > 0 ? (lSum / lCount) * 1_000_000 : 0 },
  };
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
export default function Overview() {
  const status: StatusFilter = "today";
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
  const trend = useMemo(
    () => (allUnitsQ.data ? buildTrend(allUnitsQ.data.items, granularity, status) : []),
    [allUnitsQ.data, granularity, status]
  );
  const trend7d = useMemo(
    () => (allUnitsQ.data ? buildTrend7d(allUnitsQ.data.items) : []),
    [allUnitsQ.data]
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
  const weekCompare = useMemo(
    () => (allUnitsQ.data ? buildWeekCompare(allUnitsQ.data.items) : { thisWeek: { count: 0, meanPredPpm: 0 }, lastWeek: { count: 0, meanPredPpm: 0 } }),
    [allUnitsQ.data]
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
  const meanPred = overviewQ.data.statuses[status]?.pred_mean ?? 0;
  const baseline = lotsQ.data?.baseline_risk_ratio ?? t.risk_ratio;
  const dangerLots = (lotsQ.data?.items ?? []).filter((l) => l.risk_ratio > baseline * 1.5);

  return (
    <div>
      <PageHeader title="Overview" />

      {/* KPI 3종 — 큰 사이즈 (평균 ppm / 주 비교 / 위험 unit 수) */}
      {(() => {
        const fmtDelta = (cur: number, prev: number, decimals = 0) => {
          const diff = cur - prev;
          const sign = diff > 0 ? "▲" : diff < 0 ? "▼" : "≈";
          const abs = Math.abs(diff).toFixed(decimals);
          return { sign, abs, diff };
        };
        const meanPpmDelta = fmtDelta(dayCompare.today.meanPredPpm, dayCompare.yesterday.meanPredPpm, 0);
        const weekDelta = fmtDelta(weekCompare.thisWeek.meanPredPpm, weekCompare.lastWeek.meanPredPpm, 0);
        const riskDelta = fmtDelta(dayCompare.today.riskCount, dayCompare.yesterday.riskCount, 0);
        // 색상: 증가가 나쁜 지표 (ppm/위험)
        const deltaColor = (diff: number) =>
          diff > 0 ? "#dc2626" : diff < 0 ? "#15803d" : "#64748b";
        const cardCls =
          "panel relative overflow-hidden px-6 py-5 flex flex-col justify-between min-h-[160px]";
        const labelCls =
          "text-[13px] font-semibold text-brand-textMuted uppercase tracking-wider";
        const valueCls = "tabular text-[44px] font-bold leading-none mt-2";
        return (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-5">
            {/* 1. 처리 유닛 수 (오늘) */}
            <div className={cardCls} style={{ borderLeft: "4px solid #2563eb" }}>
              <div>
                <div className={labelCls}>오늘 처리 유닛 수</div>
                <div className={valueCls} style={{ color: "#2563eb" }}>
                  {fmtInt(dayCompare.today.count)}
                </div>
              </div>
            </div>

            {/* 2. 오늘 평균 / 일주일 평균 ppm — 한 카드에 두 줄 */}
            <div className={cardCls} style={{ borderLeft: "4px solid #f59e0b" }}>
              <div>
                <div className={labelCls}>평균 예측 ppm</div>
                <div className="flex items-baseline gap-3 mt-2">
                  <div className="tabular text-[40px] font-bold leading-none" style={{ color: "#b45309" }}>
                    {fmtPpm(dayCompare.today.meanPredPpm)}
                  </div>
                  <div className="text-[12px] text-brand-textMuted font-medium">오늘</div>
                </div>
                <div className="flex items-baseline gap-3 mt-2">
                  <div className="tabular text-[24px] font-semibold leading-none" style={{ color: "#b45309" }}>
                    {fmtPpm(weekCompare.thisWeek.meanPredPpm)}
                  </div>
                  <div className="text-[12px] text-brand-textMuted font-medium">일주일 평균</div>
                </div>
              </div>
              <div className="flex flex-col gap-1 mt-3 text-[12px]">
                <div className="flex items-center gap-2">
                  <span style={{ color: deltaColor(meanPpmDelta.diff) }} className="font-semibold tabular">
                    {meanPpmDelta.sign} {fmtPpm(Number(meanPpmDelta.abs))}
                  </span>
                  <span className="text-brand-textMuted">어제 대비</span>
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ color: deltaColor(weekDelta.diff) }} className="font-semibold tabular">
                    {weekDelta.sign} {fmtPpm(Number(weekDelta.abs))}
                  </span>
                  <span className="text-brand-textMuted">지난주 대비</span>
                </div>
              </div>
            </div>

            {/* 3. 위험 유닛 수 (오늘) */}
            <div className={cardCls} style={{ borderLeft: "4px solid #dc2626" }}>
              <div>
                <div className={labelCls}>오늘 위험 유닛 수</div>
                <div className={valueCls} style={{ color: "#dc2626" }}>
                  {fmtInt(dayCompare.today.riskCount)}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3 text-[13px]">
                <span style={{ color: deltaColor(riskDelta.diff) }} className="font-semibold">
                  {riskDelta.sign} {riskDelta.abs}
                </span>
                <span className="text-brand-textMuted">어제 대비</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 최근 7일 평균 ppm — KPI 직하, 오늘 빨강 강조 + Y축 분포 구간 줌 */}
      {trend7d.length > 0 && (() => {
        const nonZeroVals = trend7d.map((d) => d.meanPredPpm).filter((v) => v > 0);
        // Y축 줌: min/max 기준 5% 여유. 데이터 없으면 fallback
        const minV = nonZeroVals.length > 0 ? Math.min(...nonZeroVals) : 0;
        const maxV = nonZeroVals.length > 0 ? Math.max(...nonZeroVals) : 1;
        const span = Math.max(maxV - minV, maxV * 0.05, 1);
        const yMin = Math.max(0, minV - span * 0.4);
        const yMax = maxV + span * 0.25;
        const threshold = triageQ.data ? healthToPpm(triageQ.data.scale.risk_threshold) : null;
        const TODAY_COLOR = "#f59e0b";
        return (
          <Panel
            title="최근 7일 평균 ppm"
            right={
              <div className="flex items-center gap-3 text-[11px]">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: CHART_COLORS.primary }} />
                  <span className="text-brand-textMuted">최근 6일</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: TODAY_COLOR }} />
                  <span className="font-semibold" style={{ color: TODAY_COLOR }}>오늘</span>
                </span>
              </div>
            }
            className="mb-4 sm:mb-5"
          >
            <div style={chartBox(220)}>
              <ResponsiveContainer>
                <LineChart data={trend7d} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="label" tick={CHART_TICK} padding={{ left: 20, right: 20 }} />
                  <YAxis
                    tick={CHART_TICK}
                    domain={[yMin, yMax]}
                    tickFormatter={(v) => `${Math.round(v).toLocaleString()}`}
                    label={{ value: "ppm", angle: -90, position: "insideLeft", fontSize: 11, fill: "#64748b" }}
                  />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    formatter={(value: any, _name: any, props: any) => {
                      const ppm = `${Math.round(Number(value)).toLocaleString()} ppm`;
                      const total = props?.payload?.totalCount ?? 0;
                      const isToday = props?.payload?.isToday;
                      return [`${ppm} · 검사 ${total.toLocaleString()}개${isToday ? " (오늘)" : ""}`, "평균 pred"];
                    }}
                  />
                  {threshold !== null && (
                    <ReferenceLine
                      y={threshold}
                      stroke={CHART_COLORS.danger}
                      strokeDasharray="4 4"
                      strokeWidth={1.2}
                      label={{
                        value: `p95 ${Math.round(threshold).toLocaleString()}`,
                        fontSize: 10,
                        fill: CHART_COLORS.danger,
                        position: "insideTopRight",
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="meanPredPpm"
                    stroke={CHART_COLORS.primary}
                    strokeWidth={2}
                    dot={(props: any) => {
                      const { cx, cy, payload, index } = props;
                      const isT = payload?.isToday;
                      return (
                        <circle
                          key={`dot-${index}`}
                          cx={cx}
                          cy={cy}
                          r={isT ? 6 : 3.5}
                          fill={isT ? TODAY_COLOR : CHART_COLORS.primary}
                          stroke="#fff"
                          strokeWidth={isT ? 2 : 1}
                        />
                      );
                    }}
                    activeDot={{ r: 6 }}
                    label={(props: any) => {
                      const { x, y, index } = props;
                      const d = trend7d[index];
                      if (!d?.isToday) return <g key={`lbl-${index}`} />;
                      return (
                        <g key={`lbl-${index}`}>
                          <rect
                            x={x - 22}
                            y={y - 26}
                            width={44}
                            height={18}
                            rx={4}
                            fill={TODAY_COLOR}
                          />
                          <text
                            x={x}
                            y={y - 13}
                            textAnchor="middle"
                            fontSize={11}
                            fontWeight={700}
                            fill="#fff"
                          >
                            오늘
                          </text>
                        </g>
                      );
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        );
      })()}

      {/* 메인 시계열 — today 모드에서는 표시 안 함 (하루치라 의미 없음) */}
      {status !== "today" && (
        <Panel
          title="기간별 평균 ppm"
          right={
            <div className="flex items-center gap-2 flex-wrap">
              <span className="chip chip-tbd" title="Mann-Kendall 추세 검정 미연결">
                <span aria-hidden>⚠</span>
                <span>추세 검정 — TBD</span>
              </span>
              {triageQ.data && (
                <span
                  className="text-[10px] text-brand-danger font-semibold"
                  title="위험 분류 임계값 (해당 status pred 상위 5%)"
                >
                  임계값 {Math.round(healthToPpm(triageQ.data.scale.risk_threshold)).toLocaleString()} ppm
                </span>
              )}
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
                  padding={{ left: 0, right: 0 }}
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
                {/* p95 위험 임계값 수평선 */}
                {triageQ.data && (
                  <ReferenceLine
                    y={healthToPpm(triageQ.data.scale.risk_threshold)}
                    stroke={CHART_COLORS.danger}
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    label={{
                      value: `p95 임계 ${Math.round(healthToPpm(triageQ.data.scale.risk_threshold)).toLocaleString()}`,
                      fontSize: 10,
                      fill: CHART_COLORS.danger,
                      position: "insideTopRight",
                    }}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      {/* 좌: Grade 분포 / 우: 위험군 vs 정상군 분리력 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5 mb-4 sm:mb-5">
        {(() => {
          const todayUnits = (allUnitsQ.data?.items ?? []).filter((u) => u.status === "today");
          const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
          for (const u of todayUnits) {
            const ppm = u.pred * 1_000_000;
            const t = TIERS.find((x) => ppm >= x.minPpm && ppm < x.maxPpm)?.tier ?? "D";
            counts[t]++;
          }
          const total = todayUnits.length || 1;
          const data = TIERS.map((t) => ({
            grade: t.tier,
            label: `Grade ${t.tier}`,
            desc: t.desc,
            count: counts[t.tier] ?? 0,
            ratio: ((counts[t.tier] ?? 0) / total) * 100,
            color: t.color,
          }));
          return (
            <Panel
              title="오늘 Grade 분포"
              right={
                <span className="text-[11px] text-brand-textMuted">
                  ppm 기준 4단계 — 총 {todayUnits.length.toLocaleString()} unit
                </span>
              }
            >
              <div style={chartBox(220)}>
                <ResponsiveContainer>
                  <BarChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid {...CHART_GRID} />
                    <XAxis dataKey="label" tick={CHART_TICK} />
                    <YAxis tick={CHART_TICK} tickFormatter={(v) => v.toLocaleString()} />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      formatter={(_v: any, _n: any, p: any) => {
                        const d = p?.payload;
                        return [
                          `${d.count.toLocaleString()} unit (${d.ratio.toFixed(1)}%)`,
                          d.desc,
                        ];
                      }}
                    />
                    <Bar dataKey="count" radius={BAR_RADIUS}>
                      {data.map((d, i) => {
                        return <Cell key={`grade-${i}`} fill={d.color} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-4 gap-2 mt-2">
                {data.map((d) => (
                  <div
                    key={d.grade}
                    className="rounded-md border border-brand-border bg-white px-2 py-1.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm"
                        style={{ background: d.color }}
                      />
                      <span className="text-[11px] font-semibold text-brand-text">
                        Grade {d.grade}
                      </span>
                    </div>
                    <div className="text-[10px] text-brand-textMuted mt-0.5">{d.desc}</div>
                    <div className="text-[14px] font-bold tabular text-brand-text mt-0.5">
                      {d.count.toLocaleString()}
                      <span className="text-[10px] text-brand-textMuted font-normal ml-1">
                        ({d.ratio.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          );
        })()}

        <Panel
          title="위험군 vs 정상군 분리력 (단위별)"
          right={
            <span className="text-[10px] text-brand-textMuted" title="anomaly_explore.ipynb 산출물">
              high = pred 상위 10%
            </span>
          }
        >
          {/* 단위별 분리력 요약 — wafer/unit/die 비교 */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { level: "wafer", n: 431, nHigh: 44, maxAuc: 0.831, ge07: 136, ge08: 3 },
              { level: "unit", n: 34914, nHigh: 3492, maxAuc: 0.771, ge07: 35, ge08: 0 },
              { level: "die", n: 139656, nHigh: 13966, maxAuc: 0.729, ge07: 9, ge08: 0 },
            ].map((row) => {
              const aucPct = Math.round(row.maxAuc * 100);
              const tone = row.maxAuc >= 0.8 ? "text-brand-danger"
                : row.maxAuc >= 0.75 ? "text-amber-600"
                : "text-brand-primary";
              return (
                <div key={row.level} className="rounded-lg border border-brand-border bg-white p-2.5">
                  <div className="text-[11px] font-semibold text-brand-text uppercase tracking-wide">
                    {row.level}
                  </div>
                  <div className={`text-[24px] font-bold tabular leading-tight ${tone}`}>
                    {aucPct}<span className="text-[12px] text-brand-textMuted ml-0.5">% AUC</span>
                  </div>
                  <div className="text-[10px] text-brand-textMuted mt-1 leading-snug">
                    n={row.n.toLocaleString()} (high {row.nHigh.toLocaleString()})
                  </div>
                  <div className="text-[10px] text-brand-textMuted mt-0.5">
                    AUC≥0.7: <span className="font-semibold text-brand-text">{row.ge07}</span>
                    {" · "}≥0.8: <span className="font-semibold text-brand-text">{row.ge08}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 3단위 공통 Top feature — wafer AUC 기준 막대 */}
          <div className="text-[11px] font-semibold text-brand-text mb-1">
            3단위 공통 Top Feature <span className="text-brand-textMuted font-normal">(wafer/unit/die Top 20 모두 포함)</span>
          </div>
          <div style={chartBox(180)}>
            <ResponsiveContainer>
              <BarChart
                data={[
                  { feature: "X769", auc: 0.831, cohenD: +1.21 },
                  { feature: "X739", auc: 0.806, cohenD: +1.10 },
                  { feature: "X774", auc: 0.798, cohenD: +1.21 },
                  { feature: "X876", auc: 0.796, cohenD: -1.23 },
                  { feature: "X844", auc: 0.792, cohenD: -0.99 },
                  { feature: "X734", auc: 0.791, cohenD: +1.20 },
                  { feature: "X744", auc: 0.785, cohenD: +1.03 },
                  { feature: "X773", auc: 0.780, cohenD: +1.12 },
                  { feature: "X770", auc: 0.778, cohenD: +1.12 },
                  { feature: "X771", auc: 0.776, cohenD: +1.10 },
                  { feature: "X772", auc: 0.775, cohenD: +1.09 },
                ]}
                layout="vertical"
                margin={{ left: 30, right: 40, top: 5, bottom: 5 }}
              >
                <CartesianGrid {...CHART_GRID} horizontal={false} />
                <XAxis type="number" domain={[0.5, 0.85]} tick={CHART_TICK} />
                <YAxis type="category" dataKey="feature" tick={CHART_TICK} width={45} />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(v: any, name: any) => {
                    if (name === "auc") return [Number(v).toFixed(3), "AUC (wafer)"];
                    return [v, name];
                  }}
                />
                <ReferenceLine x={0.7} stroke="#f59e0b" strokeDasharray="3 3" />
                <ReferenceLine x={0.8} stroke={CHART_COLORS.danger} strokeDasharray="3 3" />
                <Bar dataKey="auc" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[10px] text-brand-textMuted mt-2 leading-snug">
            wafer 단위에서 분리력이 가장 강함 (집계 노이즈 감소). 점선 = AUC 0.7(주의)·0.8(우수).
            상위 11개 변수가 wafer/unit/die 모두에서 공통 Top — 동일 핵심 신호가 단위와 무관하게 작동.
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
