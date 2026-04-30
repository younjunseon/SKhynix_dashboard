import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
} from "recharts";
import { fetchTriage, fetchUnits, type Split, type UnitItem } from "../lib/api";
import KpiCard from "../components/KpiCard";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";
import { fmtInt, fmtNum, fmtPct } from "../lib/format";

type Granularity = "day" | "week" | "month";

const RISK_THRESHOLD = 0.015;

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

// ─── 가짜 시계열 생성 (데이터 컬럼 도착 전 임시) ──────────────
//   units을 ufs_serial 해시로 시간 버킷에 분배 → 결정적 mock.
function bucketLabel(g: Granularity, idx: number): string {
  const buckets = g === "day" ? 14 : g === "week" ? 8 : 6;
  const b = idx % buckets;
  if (g === "day") {
    const d = new Date(2024, 9, 1);
    d.setDate(d.getDate() + b);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  if (g === "week") return `W${b + 1}`;
  return `${b + 1}월`;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

interface TrendBucket {
  label: string;
  trainCount: number;
  futureCount: number; // val + test (= 미래 예측)
  totalCount: number;
  defectCount: number;
  defectRate: number; // %
}

function buildTrend(units: UnitItem[], g: Granularity): TrendBucket[] {
  const nBuckets = g === "day" ? 14 : g === "week" ? 8 : 6;
  const init = (): TrendBucket => ({
    label: "",
    trainCount: 0,
    futureCount: 0,
    totalCount: 0,
    defectCount: 0,
    defectRate: 0,
  });
  const arr: TrendBucket[] = Array.from({ length: nBuckets }, init);
  for (const u of units) {
    const b = hashStr(u.ufs_serial) % nBuckets;
    arr[b].totalCount += 1;
    if (u.split === "oof") arr[b].trainCount += 1;
    else arr[b].futureCount += 1;
    if (u.pred > RISK_THRESHOLD) arr[b].defectCount += 1;
  }
  for (let i = 0; i < nBuckets; i++) {
    arr[i].label = bucketLabel(g, i);
    arr[i].defectRate = arr[i].totalCount > 0 ? (arr[i].defectCount / arr[i].totalCount) * 100 : 0;
  }
  return arr;
}

interface HistBucket {
  range: string;
  count: number;
  rangeStart: number;
}

function buildHist(units: UnitItem[]): HistBucket[] {
  // 0 ~ 0.05 구간을 20개 bin으로. 0.05 초과는 마지막 bin에 합산.
  const nBins = 20;
  const max = 0.05;
  const step = max / nBins;
  const counts = new Array(nBins).fill(0);
  for (const u of units) {
    const v = Math.max(0, u.pred);
    let idx = Math.floor(v / step);
    if (idx >= nBins) idx = nBins - 1;
    counts[idx] += 1;
  }
  return counts.map((c, i) => ({
    range: `${(i * step).toFixed(3)}`,
    rangeStart: i * step,
    count: c,
  }));
}

export default function Overview() {
  const [split, setSplit] = useState<Split>("test");
  const [granularity, setGranularity] = useState<Granularity>("day");

  const triageQ = useQuery({
    queryKey: ["triage", split],
    queryFn: () => fetchTriage({ split, top_units: 10, top_wafers: 10, unit_cost: 1_000_000 }),
  });

  // 추이/히스토그램용 — 모든 split의 unit을 한 번에 받아서 클라이언트에서 집계.
  const allUnitsQ = useQuery({
    queryKey: ["units-all"],
    queryFn: () => fetchUnits({ page: 1, page_size: 500, sort: "pred", order: "desc" }),
  });

  const trend = useMemo(
    () => (allUnitsQ.data ? buildTrend(allUnitsQ.data.items, granularity) : []),
    [allUnitsQ.data, granularity]
  );
  const hist = useMemo(
    () => (allUnitsQ.data ? buildHist(allUnitsQ.data.items.filter((u) => u.split === split)) : []),
    [allUnitsQ.data, split]
  );

  if (triageQ.isLoading) return <div className="text-[11px] p-2">로딩 중…</div>;
  if (triageQ.error || !triageQ.data)
    return (
      <div className="panel p-3 text-[11px] text-sf-danger">
        API 연결 실패. uvicorn 서버가 떠 있는지 확인하세요.
      </div>
    );

  const data = triageQ.data;
  const s = data.summary;

  // 평균 health = test/val의 실측 또는 예측 평균. 임시로 unit pred 평균 사용 (나중에 실측 컬럼 합쳐도 됨).
  const meanPred = allUnitsQ.data
    ? allUnitsQ.data.items
        .filter((u) => u.split === split)
        .reduce((acc, u) => acc + u.pred, 0) /
      Math.max(1, allUnitsQ.data.items.filter((u) => u.split === split).length)
    : 0;

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle="기간별 완료 unit 수와 예측 불량률 추이"
        split={split}
        onSplitChange={setSplit}
      />

      {/* KPI: 2개 */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <KpiCard
          label="예측 불량률"
          value={fmtPct(s.risk_ratio)}
          hint={`${fmtInt(s.n_risk)} / ${fmtInt(s.n_units)} units · split = ${split}`}
          tone="accent"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          }
        />
        <KpiCard
          label="평균 health (예측)"
          value={fmtNum(meanPred, 5)}
          hint={`pred mean · split = ${split}`}
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5L8 8l4 4 8-8M14 4h6v6" />
            </svg>
          }
        />
      </div>

      {/* 메인: 듀얼축 차트 */}
      <Panel
        title="기간별 완료수량 & 예측 불량률"
        right={
          <div className="inline-flex bg-brand-subtle rounded-lg overflow-hidden">
            {(["day", "week", "month"] as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`text-[11px] px-3 py-1 font-medium transition-colors ${
                  granularity === g
                    ? "bg-brand-primary text-white"
                    : "text-brand-textMuted hover:text-brand-text"
                }`}
              >
                {g === "day" ? "일별" : g === "week" ? "주별" : "월별"}
              </button>
            ))}
          </div>
        }
        className="mb-4"
      >
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <ComposedChart data={trend} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d4d4d4" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11 }}
                label={{ value: "완료 수량", angle: -90, position: "insideLeft", fontSize: 11 }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11 }}
                label={{ value: "불량률(%)", angle: 90, position: "insideRight", fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(value: any, name: any) => {
                  if (name === "불량률") return `${Number(value).toFixed(2)}%`;
                  return Number(value).toLocaleString();
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                yAxisId="left"
                dataKey="trainCount"
                stackId="a"
                fill="#4c1d95"
                name="train (실측)"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                yAxisId="left"
                dataKey="futureCount"
                stackId="a"
                fill="#a78bfa"
                name="val/test (예측)"
                radius={[4, 4, 0, 0]}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="defectRate"
                stroke="#e53e3e"
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: "#e53e3e" }}
                name="불량률"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      {/* 하단: Top 위험 + 분포 히스토그램 */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Panel
          title="Top 10 위험 Wafer"
          right={
            <Link to="/wafers" className="text-[11px] text-white/90 hover:underline">
              View Map →
            </Link>
          }
          bodyClassName="p-0"
        >
          <table className="spotfire">
            <thead>
              <tr>
                <th>Wafer</th>
                <th className="text-right">Units</th>
                <th className="text-right">Risk</th>
                <th className="text-right">Ratio</th>
              </tr>
            </thead>
            <tbody>
              {data.top_wafers.slice(0, 10).map((w) => (
                <tr key={w.wafer_key}>
                  <td>
                    <Link
                      to={`/wafers?key=${encodeURIComponent(w.wafer_key)}`}
                      className="text-sf-link hover:underline font-mono"
                    >
                      {w.wafer_key}
                    </Link>
                  </td>
                  <td className="text-right tabular">{fmtInt(w.n_units)}</td>
                  <td className="text-right tabular text-sf-danger font-semibold">{fmtInt(w.n_risk)}</td>
                  <td className="text-right tabular font-bold">{fmtPct(w.risk_ratio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel
          title="Top 10 위험 Unit"
          right={
            <button
              onClick={() => downloadCsv(data.top_units, `risk_units_${split}.csv`)}
              className="btn btn-primary text-[10px]"
            >
              ↓ CSV
            </button>
          }
          bodyClassName="p-0"
        >
          <table className="spotfire">
            <thead>
              <tr>
                <th>Unit</th>
                <th className="text-right">Pred</th>
                <th>Wafer</th>
              </tr>
            </thead>
            <tbody>
              {data.top_units.slice(0, 10).map((u) => (
                <tr key={u.ufs_serial}>
                  <td className="font-mono">{u.ufs_serial}</td>
                  <td className="text-right tabular font-mono font-bold text-sf-danger">
                    {fmtNum(u.pred)}
                  </td>
                  <td>
                    <Link
                      to={`/wafers?key=${u.wafer_key}`}
                      className="text-sf-link hover:underline font-mono"
                    >
                      {u.wafer_key}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel title="예측 health 분포 (zero-inflated)">
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer>
            <BarChart data={hist} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d4d4d4" />
              <XAxis dataKey="range" tick={{ fontSize: 10 }} interval={1} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(value: any) => Number(value).toLocaleString()}
                labelFormatter={(label: any) => `pred ≥ ${label}`}
              />
              <Bar dataKey="count" fill="#4c1d95" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  );
}
