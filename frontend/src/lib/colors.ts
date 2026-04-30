/**
 * Spotfire 스타일 wafer map 색상.
 * 회색(낮음) → 옅은 노랑 → 노랑 → 주황 → 빨강(높음).
 */
const STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [220, 220, 220]],   // light gray
  [0.25, [255, 245, 200]],  // pale yellow
  [0.5, [255, 215, 100]],   // yellow
  [0.75, [240, 130, 50]],   // orange
  [1.0, [200, 25, 25]],     // deep red
];

export function predColor(pred: number, predMin: number, predMax: number, _threshold: number): string {
  const range = predMax - predMin || 1;
  const t = Math.max(0, Math.min(1, (pred - predMin) / range));
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0 || 1);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * k);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * k);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * k);
      return `rgb(${r},${g},${b})`;
    }
  }
  return `rgb(${STOPS[STOPS.length - 1][1].join(",")})`;
}

export const COLOR_LEGEND_GRADIENT =
  "linear-gradient(to right, #dcdcdc, #fff5c8, #ffd764, #f08232, #c81919)";
