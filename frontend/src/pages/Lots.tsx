import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchLotDetail, fetchLots, type Split } from "../lib/api";
import KpiCard from "../components/KpiCard";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";
import { fmtInt, fmtPct } from "../lib/format";

export default function Lots() {
  const [split, setSplit] = useState<Split>("test");
  const [selectedRun, setSelectedRun] = useState<string | null>(null);

  const lotsQ = useQuery({
    queryKey: ["lots", split],
    queryFn: () => fetchLots({ split, sort: "risk_ratio", limit: 50 }),
  });
  const detailQ = useQuery({
    queryKey: ["lot-detail", selectedRun, split],
    queryFn: () => fetchLotDetail(selectedRun!, split),
    enabled: !!selectedRun,
  });

  const baseline = lotsQ.data?.baseline_risk_ratio ?? 0;
  const topLot = lotsQ.data?.items[0];
  const maxRatio = Math.max(...(lotsQ.data?.items.map((i) => i.risk_ratio) ?? [1]));

  return (
    <div>
      <PageHeader
        title="Lot Analysis"
        subtitle="Run(lot) 단위 위험도 — 어느 작업 배치가 문제인지 식별"
        split={split}
        onSplitChange={setSplit}
      />

      {lotsQ.data && (
        <div className="grid grid-cols-4 gap-2 mb-2">
          <KpiCard label="Total Lots" value={fmtInt(lotsQ.data.n_lots_total)} />
          <KpiCard label="Baseline Risk" value={fmtPct(baseline)} hint="전체 평균 위험률" tone="info" />
          <KpiCard
            label="Top Lot Risk"
            value={fmtPct(topLot?.risk_ratio ?? 0)}
            tone="danger"
            hint={`run_id ${topLot?.run_id ?? "-"}`}
          />
          <KpiCard
            label="Top Lift"
            value={`${(topLot?.lift ?? 0).toFixed(1)}×`}
            tone="warn"
            hint="평균 대비 배수"
          />
        </div>
      )}

      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-7">
          <Panel
            title="Lots — Top 50 by risk_ratio"
            right={<span className="text-[10px] text-white/80">클릭 시 상세</span>}
            bodyClassName="p-0"
          >
            <div className="max-h-[640px] overflow-y-auto">
              <table className="spotfire">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th>Run ID</th>
                    <th className="text-right">Wafers</th>
                    <th className="text-right">Units</th>
                    <th className="text-right">Risk</th>
                    <th>Risk Ratio</th>
                    <th className="text-right">Lift</th>
                  </tr>
                </thead>
                <tbody>
                  {lotsQ.data?.items.map((lot) => {
                    const active = selectedRun === lot.run_id;
                    const barW = (lot.risk_ratio / maxRatio) * 100;
                    return (
                      <tr
                        key={lot.run_id}
                        onClick={() => setSelectedRun(lot.run_id)}
                        className={`cursor-pointer ${active ? "active" : ""}`}
                      >
                        <td className="font-mono font-semibold">{lot.run_id}</td>
                        <td className="text-right tabular">{fmtInt(lot.n_wafers)}</td>
                        <td className="text-right tabular">{fmtInt(lot.n_units)}</td>
                        <td
                          className={`text-right tabular font-semibold ${
                            active ? "" : "text-sf-danger"
                          }`}
                        >
                          {fmtInt(lot.n_risk)}
                        </td>
                        <td className="w-[180px]">
                          <div className="flex items-center gap-2">
                            <div
                              className={`flex-1 h-2.5 border ${
                                active ? "border-white/40 bg-white/20" : "border-slate-400 bg-slate-100"
                              }`}
                            >
                              <div
                                className="h-full"
                                style={{
                                  width: `${barW}%`,
                                  background: active
                                    ? "#fff"
                                    : lot.risk_ratio > 0.3
                                    ? "linear-gradient(to right, #f08232, #c81919)"
                                    : lot.risk_ratio > 0.1
                                    ? "linear-gradient(to right, #ffd764, #f08232)"
                                    : "#1f4e8c",
                                }}
                              />
                            </div>
                            <span className="font-mono tabular text-[10px] font-bold w-10 text-right">
                              {fmtPct(lot.risk_ratio)}
                            </span>
                          </div>
                        </td>
                        <td
                          className={`text-right tabular font-mono font-bold ${
                            active ? "" : "text-sf-warn"
                          }`}
                        >
                          {lot.lift.toFixed(1)}×
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="col-span-5">
          {!selectedRun && (
            <Panel title="Lot Detail">
              <div className="text-[11px] text-slate-600 p-3 text-center">
                ← lot을 선택하세요
              </div>
            </Panel>
          )}
          {selectedRun && detailQ.isLoading && (
            <Panel title="Lot Detail">
              <div className="text-[11px] text-slate-600 p-3">로딩…</div>
            </Panel>
          )}
          {detailQ.data && (
            <div className="space-y-2">
              <Panel title={`Lot ${detailQ.data.run_id}`}>
                <table className="spotfire">
                  <tbody>
                    <tr>
                      <th>Wafers</th>
                      <td className="tabular">{fmtInt(detailQ.data.summary.n_wafers)}</td>
                      <th>Units</th>
                      <td className="tabular">{fmtInt(detailQ.data.summary.n_units)}</td>
                    </tr>
                    <tr>
                      <th>Risk</th>
                      <td className="tabular text-sf-danger font-semibold">
                        {fmtInt(detailQ.data.summary.n_risk)}
                      </td>
                      <th>Ratio</th>
                      <td className="tabular font-bold">{fmtPct(detailQ.data.summary.risk_ratio)}</td>
                    </tr>
                  </tbody>
                </table>
              </Panel>

              <Panel title="Wafers in this lot" bodyClassName="p-0">
                <div className="max-h-[480px] overflow-y-auto">
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
                      {detailQ.data.wafers.map((w) => (
                        <tr key={w.wafer_key}>
                          <td>
                            <Link
                              to={`/wafers?key=${encodeURIComponent(w.wafer_key)}`}
                              className="text-sf-link hover:underline font-mono"
                            >
                              #{w.wafer_no}
                            </Link>
                          </td>
                          <td className="text-right tabular">{fmtInt(w.n_units)}</td>
                          <td className="text-right tabular text-sf-danger font-semibold">
                            {fmtInt(w.n_risk)}
                          </td>
                          <td className="text-right tabular font-bold">{fmtPct(w.risk_ratio)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
