export const fmtNum = (v: number | null | undefined, digits = 5) =>
  v === null || v === undefined || Number.isNaN(v) ? "-" : v.toFixed(digits);

export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || Number.isNaN(v)
    ? "-"
    : `${(v * 100).toFixed(digits)}%`;

export const fmtInt = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? "-" : v.toLocaleString();
