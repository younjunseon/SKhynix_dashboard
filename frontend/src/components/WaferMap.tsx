import { useMemo } from "react";
import type { DieItem } from "../lib/api";
import { COLOR_LEGEND_GRADIENT, predColor } from "../lib/colors";

interface Props {
  dies: DieItem[];
  scale: { pred_min: number; pred_max: number; risk_threshold: number };
  selectedUnit?: string | null;
  onSelectUnit?: (ufsSerial: string) => void;
  size?: number;
  title?: string;
}

export default function WaferMap({ dies, scale, selectedUnit, onSelectUnit, size = 480, title }: Props) {
  const { cells, gridSize, cellSize, xMin, yMin } = useMemo(() => {
    if (dies.length === 0)
      return { cells: [], gridSize: 1, cellSize: 1, xMin: 0, yMin: 0 };
    const xs = dies.map((d) => d.die_x);
    const ys = dies.map((d) => d.die_y);
    const xMin = Math.min(...xs);
    const yMin = Math.min(...ys);
    const w = Math.max(...xs) - xMin + 1;
    const h = Math.max(...ys) - yMin + 1;
    const gridSize = Math.max(w, h);
    const cellSize = (size - 4) / gridSize;
    return { cells: dies, gridSize, cellSize, xMin, yMin };
  }, [dies, size]);

  if (dies.length === 0)
    return <div className="text-slate-600 text-[11px] p-2">표시할 die가 없습니다.</div>;

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 2;

  return (
    <div>
      {title && (
        <div className="text-[11px] font-semibold text-slate-800 mb-1">{title}</div>
      )}
      <div className="flex items-start gap-3">
        {/* 차트 */}
        <div className="border border-sf-border bg-white">
          <svg width={size} height={size} className="block">
            <defs>
              <clipPath id="waferCircle">
                <circle cx={cx} cy={cy} r={radius} />
              </clipPath>
            </defs>
            <circle cx={cx} cy={cy} r={radius} fill="#fafafa" stroke="#888" strokeWidth={1} />
            <g clipPath="url(#waferCircle)">
              {cells.map((d) => {
                const x = (d.die_x - xMin) * cellSize + 2;
                const y = (d.die_y - yMin) * cellSize + 2;
                const isSelected = d.ufs_serial === selectedUnit;
                return (
                  <g key={d.run_wf_xy}>
                    <title>
                      {d.run_wf_xy}
                      {"\n"}pred={d.pred.toFixed(5)} π={d.pi.toFixed(3)} μ={d.mu.toFixed(5)}
                      {d.ufs_serial ? `\nunit=${d.ufs_serial}` : ""}
                    </title>
                    <rect
                      x={x}
                      y={y}
                      width={cellSize - 0.3}
                      height={cellSize - 0.3}
                      fill={predColor(d.pred, scale.pred_min, scale.pred_max, scale.risk_threshold)}
                      stroke={isSelected ? "#000" : "rgba(0,0,0,0.15)"}
                      strokeWidth={isSelected ? 1.5 : 0.3}
                      className={onSelectUnit ? "cursor-pointer" : ""}
                      onClick={() => d.ufs_serial && onSelectUnit?.(d.ufs_serial)}
                    />
                  </g>
                );
              })}
            </g>
            <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#555" strokeWidth={1} />
          </svg>
          <div className="text-[10px] text-slate-700 text-center px-1 py-0.5 border-t border-sf-border bg-sf-headBg">
            Xdiepos
          </div>
        </div>

        {/* 범례 (Spotfire 우측 컬러키) */}
        <div className="text-[10px] text-slate-800 leading-tight">
          <div className="font-semibold mb-1">Pred</div>
          <div className="flex flex-col gap-0">
            {[1.0, 0.92, 0.86, 0.8, 0.75, 0.65, 0.5, 0.25, 0].map((t, i, arr) => {
              const next = arr[i + 1] ?? -0.01;
              const v = scale.pred_min + (scale.pred_max - scale.pred_min) * t;
              const vNext = scale.pred_min + (scale.pred_max - scale.pred_min) * next;
              return (
                <div key={t} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-3 h-3 border border-slate-500"
                    style={{ background: predColor(v, scale.pred_min, scale.pred_max, scale.risk_threshold) }}
                  />
                  <span className="font-mono tabular text-[9px]">
                    {next < 0 ? `≤ ${v.toFixed(4)}` : `${vNext.toFixed(4)} – ${v.toFixed(4)}`}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-300 text-[9px] text-slate-600 leading-snug">
            <div>{cells.length} dies</div>
            <div>{gridSize}×{gridSize}</div>
            <div className="mt-1">
              threshold:<br />
              <span className="font-mono">{scale.risk_threshold.toFixed(4)}</span>
            </div>
          </div>
          <div className="mt-2">
            <div
              className="w-full h-2 border border-slate-500"
              style={{ background: COLOR_LEGEND_GRADIENT }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
