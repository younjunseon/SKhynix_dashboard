import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  fetchTriage,
  fetchUnitReport,
  fetchWaferDetail,
  fetchWafers,
  type Split,
} from "../lib/api";
import WaferMap from "../components/WaferMap";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";
import { fmtInt, fmtNum, fmtPct } from "../lib/format";

export default function Wafers() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialKey = searchParams.get("key");
  const [split, setSplit] = useState<Split>("test");
  const [selectedKey, setSelectedKey] = useState<string | null>(initialKey);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);

  const triageQ = useQuery({
    queryKey: ["triage-scale", split],
    queryFn: () => fetchTriage({ split, top_units: 1, top_wafers: 1 }),
  });
  const wafersQ = useQuery({
    queryKey: ["wafers-list", split],
    queryFn: () => fetchWafers({ split, sort: "risk_ratio", limit: 100 }),
  });
  const detailQ = useQuery({
    queryKey: ["wafer-detail", selectedKey],
    queryFn: () => fetchWaferDetail(selectedKey!),
    enabled: !!selectedKey,
  });
  const reportQ = useQuery({
    queryKey: ["unit-report", selectedUnit],
    queryFn: () => fetchUnitReport(selectedUnit!),
    enabled: !!selectedUnit,
    retry: false,
  });

  useEffect(() => {
    if (selectedKey) setSearchParams({ key: selectedKey });
    else setSearchParams({});
  }, [selectedKey, setSearchParams]);

  useEffect(() => {
    setSelectedUnit(null);
  }, [selectedKey]);

  const scale = triageQ.data?.scale;

  return (
    <div>
      <PageHeader
        title="Wafer Map"
        subtitle="위험 wafer 선택 → die 단위 패턴 → unit 진단"
        split={split}
        onSplitChange={setSplit}
      />

      <div className="grid grid-cols-12 gap-4">
        {/* 좌: wafer 목록 */}
        <div className="col-span-3">
          <Panel title="Wafers (sorted by risk_ratio)" bodyClassName="p-0">
            <div className="max-h-[680px] overflow-y-auto">
              <table className="spotfire">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th>Wafer</th>
                    <th className="text-right">Risk%</th>
                    <th className="text-right">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {wafersQ.data?.items.map((w) => {
                    const active = selectedKey === w.wafer_key;
                    return (
                      <tr
                        key={w.wafer_key}
                        onClick={() => setSelectedKey(w.wafer_key)}
                        className={`cursor-pointer ${active ? "active" : ""}`}
                      >
                        <td className="font-mono">{w.wafer_key}</td>
                        <td
                          className={`text-right tabular font-bold ${
                            active
                              ? ""
                              : w.risk_ratio > 0.5
                              ? "text-sf-danger"
                              : w.risk_ratio > 0.2
                              ? "text-sf-warn"
                              : ""
                          }`}
                        >
                          {fmtPct(w.risk_ratio)}
                        </td>
                        <td className="text-right tabular">{fmtInt(w.n_units)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        {/* 중: wafer map */}
        <div className="col-span-6">
          {!selectedKey && (
            <Panel title="Wafer Map">
              <div className="text-[11px] text-slate-600 p-6 text-center">
                ← 좌측 목록에서 wafer를 선택하세요
              </div>
            </Panel>
          )}
          {selectedKey && detailQ.isLoading && (
            <Panel title="Wafer Map">
              <div className="text-[11px] text-slate-600 p-6 text-center">로딩…</div>
            </Panel>
          )}
          {detailQ.data && scale && (
            <Panel
              title={`Wafer Map — ${detailQ.data.wafer_key}`}
              right={
                <span className="text-[10px] text-white/80">
                  Units {fmtInt(detailQ.data.summary?.n_units)} · Risk{" "}
                  <span className="font-bold text-amber-300">
                    {fmtInt(detailQ.data.summary?.n_risk)}
                  </span>{" "}
                  · Max {fmtNum(detailQ.data.summary?.max_pred)}
                </span>
              }
            >
              <WaferMap
                dies={detailQ.data.dies}
                scale={scale}
                selectedUnit={selectedUnit}
                onSelectUnit={setSelectedUnit}
              />
            </Panel>
          )}
        </div>

        {/* 우: unit 진단 */}
        <div className="col-span-3">
          <Panel title="Unit Diagnosis">
            {!selectedUnit && (
              <div className="text-[11px] text-slate-600 p-3">
                wafer map의 die를 클릭하면 unit 진단이 표시됩니다.
              </div>
            )}
            {selectedUnit && reportQ.isLoading && (
              <div className="text-[11px] text-slate-600 p-3">로딩…</div>
            )}
            {reportQ.data && (
              <div className="space-y-3">
                <div
                  className={`px-2 py-1.5 border ${
                    reportQ.data.verdict === "WARNING"
                      ? "bg-red-50 border-sf-danger"
                      : "bg-green-50 border-green-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[12px] font-bold ${
                        reportQ.data.verdict === "WARNING"
                          ? "text-sf-danger"
                          : "text-green-700"
                      }`}
                    >
                      {reportQ.data.verdict === "WARNING" ? "⚠ WARNING" : "✓ NORMAL"}
                    </span>
                    <span className="font-mono text-[10px] text-slate-700">
                      {reportQ.data.ufs_serial}
                    </span>
                  </div>
                </div>

                <ul className="space-y-1 text-[11px] text-slate-800">
                  {reportQ.data.narrative.map((line, i) => (
                    <li key={i} className="flex gap-1.5 leading-snug">
                      <span className="text-sf-blue">•</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>

                <table className="spotfire">
                  <tbody>
                    <tr>
                      <th>Pred</th>
                      <td className="font-mono tabular text-sf-danger font-bold">{fmtNum(reportQ.data.pred)}</td>
                    </tr>
                    <tr>
                      <th>Health</th>
                      <td className="font-mono tabular">{fmtNum(reportQ.data.health)}</td>
                    </tr>
                    <tr>
                      <th>π mean</th>
                      <td className="font-mono tabular">{fmtNum(reportQ.data.pi_mean, 3)}</td>
                    </tr>
                    <tr>
                      <th>μ mean</th>
                      <td className="font-mono tabular">{fmtNum(reportQ.data.mu_mean)}</td>
                    </tr>
                    <tr>
                      <th>Percentile</th>
                      <td className="font-mono tabular">{fmtPct(reportQ.data.pred_rank)}</td>
                    </tr>
                  </tbody>
                </table>

                {reportQ.data.worst_die && (
                  <div className="border border-sf-softBorder bg-sf-headBg px-2 py-1.5">
                    <div className="text-[10px] text-slate-600 font-semibold mb-0.5">
                      Worst Die
                    </div>
                    <div className="font-mono text-[11px]">
                      ({reportQ.data.worst_die.die_x}, {reportQ.data.worst_die.die_y}) · pred{" "}
                      <span className="font-bold text-sf-danger">
                        {fmtNum(reportQ.data.worst_die.pred)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
