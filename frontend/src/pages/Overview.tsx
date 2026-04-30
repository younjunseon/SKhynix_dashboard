import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchTriage, type Split, type UnitItem } from "../lib/api";
import KpiCard from "../components/KpiCard";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";
import { fmtInt, fmtNum, fmtPct } from "../lib/format";

const UNIT_COST = 1_000_000;

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

export default function Overview() {
  const [split, setSplit] = useState<Split>("test");
  const { data, isLoading, error } = useQuery({
    queryKey: ["triage", split],
    queryFn: () => fetchTriage({ split, top_units: 20, top_wafers: 10, unit_cost: UNIT_COST }),
  });

  if (isLoading) return <div className="text-[11px] p-2">로딩 중…</div>;
  if (error || !data)
    return (
      <div className="panel p-3 text-[11px] text-sf-danger">
        API 연결 실패. uvicorn 서버가 떠 있는지 확인하세요.
      </div>
    );

  const s = data.summary;

  return (
    <div>
      <PageHeader
        title="Risk Triage"
        subtitle="위험 Unit 사전 식별 → 후속 공정 손실 최소화"
        split={split}
        onSplitChange={setSplit}
      />

      <div className="grid grid-cols-4 gap-2 mb-2">
        <KpiCard
          label="Risk Units"
          value={fmtInt(s.n_risk)}
          hint={`${fmtPct(s.risk_ratio)} of ${fmtInt(s.n_units)}`}
          tone="danger"
        />
        <KpiCard
          label="Estimated Loss"
          value={`₩${(s.estimated_loss / 100_000_000).toFixed(2)}억`}
          hint={`@ ₩${(s.unit_cost / 10_000).toLocaleString()}만/unit`}
          tone="warn"
        />
        <KpiCard label="Model RMSE" value={fmtNum(s.rmse)} hint={`split = ${split}`} tone="info" />
        <KpiCard label="Threshold" value="Top 5%" hint={`pred > ${fmtNum(data.scale.risk_threshold)}`} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Panel
          title="Top Risk Wafers"
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
                <th className="text-right">Mean Pred</th>
              </tr>
            </thead>
            <tbody>
              {data.top_wafers.map((w) => (
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
                  <td className="text-right tabular font-mono">{fmtNum(w.mean_pred)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel
          title="Top Risk Units"
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
                <th className="text-right">π</th>
                <th className="text-right">μ</th>
                <th>Wafer</th>
              </tr>
            </thead>
            <tbody>
              {data.top_units.slice(0, 12).map((u) => (
                <tr key={u.ufs_serial}>
                  <td className="font-mono">{u.ufs_serial}</td>
                  <td className="text-right tabular font-mono font-bold text-sf-danger">{fmtNum(u.pred)}</td>
                  <td className="text-right tabular font-mono">{fmtNum(u.pi_mean, 3)}</td>
                  <td className="text-right tabular font-mono">{fmtNum(u.mu_mean)}</td>
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
          {data.top_units.length > 12 && (
            <div className="text-[10px] text-slate-600 px-2 py-1 border-t border-sf-border bg-sf-headBg">
              + {data.top_units.length - 12} more rows in CSV
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
