import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchUnits, type Split, type UnitItem } from "../lib/api";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";
import { fmtInt, fmtNum, fmtPct } from "../lib/format";

type SortKey = "pred" | "health";
type Order = "asc" | "desc";

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

export default function Data() {
  const [split, setSplit] = useState<Split>("test");
  const [riskOnly, setRiskOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("pred");
  const [order, setOrder] = useState<Order>("desc");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const pageSize = 50;

  const { data, isLoading, error } = useQuery({
    queryKey: ["units-table", split, riskOnly, sort, order, page],
    queryFn: () =>
      fetchUnits({
        split,
        risk_only: riskOnly,
        sort,
        order,
        page,
        page_size: pageSize,
      }),
  });

  const filtered =
    data && search
      ? data.items.filter(
          (u) =>
            u.ufs_serial.toLowerCase().includes(search.toLowerCase()) ||
            u.wafer_key.toLowerCase().includes(search.toLowerCase()) ||
            u.run_id.toLowerCase().includes(search.toLowerCase())
        )
      : data?.items ?? [];

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  function toggleSort(k: SortKey) {
    if (sort === k) {
      setOrder(order === "desc" ? "asc" : "desc");
    } else {
      setSort(k);
      setOrder("desc");
    }
    setPage(1);
  }

  function sortIndicator(k: SortKey) {
    if (sort !== k) return "";
    return order === "desc" ? " ▼" : " ▲";
  }

  return (
    <div>
      <PageHeader
        title="Data"
        subtitle="전체 unit 데이터 — 필터·검색·정렬·CSV 다운로드"
        split={split}
        onSplitChange={(s) => {
          setSplit(s);
          setPage(1);
        }}
      />

      {/* 필터/검색/액션 바 */}
      <Panel title="Filters" className="mb-4">
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={riskOnly}
              onChange={(e) => {
                setRiskOnly(e.target.checked);
                setPage(1);
              }}
            />
            <span>위험 unit만 (is_risk=true)</span>
          </label>

          <div className="flex items-center gap-1">
            <span className="text-slate-700">검색:</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ufs_serial / wafer_key / run_id"
              className="border border-slate-500 bg-white text-[11px] px-1 py-0.5 w-64"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-slate-700">
              총 {fmtInt(total)} rows · 표시 {filtered.length}
            </span>
            <button
              onClick={() => downloadCsv(filtered, `units_${split}_p${page}.csv`)}
              className="btn btn-primary text-[10px]"
              disabled={filtered.length === 0}
            >
              ↓ CSV (현재 페이지)
            </button>
          </div>
        </div>
      </Panel>

      {/* 테이블 */}
      <Panel title="Units" bodyClassName="p-0">
        {isLoading && <div className="text-[11px] p-3">로딩…</div>}
        {error && (
          <div className="text-[11px] text-sf-danger p-3">
            API 연결 실패. uvicorn 서버가 떠 있는지 확인하세요.
          </div>
        )}
        {data && (
          <div className="max-h-[560px] overflow-y-auto">
            <table className="spotfire">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>ufs_serial</th>
                  <th>split</th>
                  <th>run_id</th>
                  <th>wafer</th>
                  <th
                    className="text-right cursor-pointer select-none"
                    onClick={() => toggleSort("pred")}
                  >
                    pred{sortIndicator("pred")}
                  </th>
                  <th
                    className="text-right cursor-pointer select-none"
                    onClick={() => toggleSort("health")}
                  >
                    health{sortIndicator("health")}
                  </th>
                  <th className="text-right">π mean</th>
                  <th className="text-right">μ mean</th>
                  <th className="text-center">위험</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.ufs_serial}>
                    <td className="font-mono">{u.ufs_serial}</td>
                    <td>{u.split}</td>
                    <td className="font-mono">{u.run_id}</td>
                    <td>
                      <Link
                        to={`/wafers?key=${encodeURIComponent(u.wafer_key)}`}
                        className="text-sf-link hover:underline font-mono"
                      >
                        {u.wafer_key}
                      </Link>
                    </td>
                    <td
                      className={`text-right tabular font-mono ${
                        u.is_risk ? "text-sf-danger font-bold" : ""
                      }`}
                    >
                      {fmtNum(u.pred)}
                    </td>
                    <td className="text-right tabular font-mono">{fmtNum(u.health)}</td>
                    <td className="text-right tabular font-mono">{fmtNum(u.pi_mean, 3)}</td>
                    <td className="text-right tabular font-mono">{fmtNum(u.mu_mean)}</td>
                    <td className="text-center">
                      {u.is_risk ? (
                        <span className="text-sf-danger font-bold">⚠</span>
                      ) : (
                        <span className="text-slate-400">·</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center text-slate-600 p-3">
                      조건에 맞는 unit이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* 페이지네이션 */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-between text-[11px] mt-2 px-1">
          <div className="text-slate-700">
            page {page} / {totalPages} · {fmtPct((page * pageSize) / Math.max(1, total))}
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="border border-slate-500 bg-white px-1.5 py-0.5 disabled:opacity-50"
            >
              « 처음
            </button>
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="border border-slate-500 bg-white px-1.5 py-0.5 disabled:opacity-50"
            >
              ‹ 이전
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="border border-slate-500 bg-white px-1.5 py-0.5 disabled:opacity-50"
            >
              다음 ›
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              className="border border-slate-500 bg-white px-1.5 py-0.5 disabled:opacity-50"
            >
              마지막 »
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
