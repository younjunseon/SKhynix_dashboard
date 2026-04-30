import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? "",
  timeout: 15000,
});

export type Split = "oof" | "val" | "test";

export interface SplitStats {
  n_units: number;
  rmse: number;
  n_risk: number;
  risk_ratio: number;
  pred_mean: number;
  pred_max: number;
  health_zero_ratio: number;
}

export interface Overview {
  risk_top_ratio: number;
  splits: Record<Split, SplitStats>;
  totals: { n_units: number; n_dies: number; n_wafers: number };
}

export interface WaferSummary {
  wafer_key: string;
  run_id: string;
  wafer_no: string;
  split: Split;
  n_units: number;
  mean_pred: number;
  max_pred: number;
  n_risk: number;
  mean_health: number;
  risk_ratio: number;
}

export interface UnitItem {
  ufs_serial: string;
  pred: number;
  health: number;
  split: Split;
  run_id: string;
  wafer_no: string;
  wafer_key: string;
  pi_mean: number;
  mu_mean: number;
  is_risk: boolean;
}

export interface DieItem {
  run_wf_xy: string;
  die_x: number;
  die_y: number;
  pi: number;
  one_minus_pi: number;
  mu: number;
  pred: number;
  health?: number;
  ufs_serial?: string;
  split?: Split;
}

export const fetchOverview = () =>
  api.get<Overview>("/api/overview").then((r) => r.data);

export const fetchWafers = (params: {
  split?: Split;
  sort?: string;
  limit?: number;
}) =>
  api
    .get<{ count: number; items: WaferSummary[] }>("/api/wafers", { params })
    .then((r) => r.data);

export const fetchWaferDetail = (waferKey: string) =>
  api
    .get<{
      wafer_key: string;
      summary: WaferSummary;
      dies: DieItem[];
      units: UnitItem[];
    }>(`/api/wafers/${waferKey}`)
    .then((r) => r.data);

export const fetchUnits = (params: {
  split?: Split;
  risk_only?: boolean;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  page_size?: number;
}) =>
  api
    .get<{
      total: number;
      page: number;
      page_size: number;
      items: UnitItem[];
    }>("/api/units", { params })
    .then((r) => r.data);

export const fetchUnitDetail = (ufsSerial: string) =>
  api
    .get<{ unit: UnitItem; dies: DieItem[] }>(`/api/units/${ufsSerial}`)
    .then((r) => r.data);

export interface TriageSummary {
  n_units: number;
  n_risk: number;
  risk_ratio: number;
  estimated_loss: number;
  unit_cost: number;
  rmse: number;
}

export interface ScaleInfo {
  pred_min: number;
  pred_max: number;
  risk_threshold: number;
}

export interface TriageResponse {
  split: Split;
  summary: TriageSummary;
  scale: ScaleInfo;
  top_wafers: WaferSummary[];
  top_units: UnitItem[];
}

export interface LotItem {
  run_id: string;
  n_units: number;
  n_wafers: number;
  n_risk: number;
  mean_pred: number;
  max_pred: number;
  mean_health: number;
  risk_ratio: number;
  lift: number;
}

export interface LotsResponse {
  split: Split;
  baseline_risk_ratio: number;
  n_lots_total: number;
  items: LotItem[];
}

export interface LotDetail {
  run_id: string;
  split: Split;
  summary: {
    n_units: number;
    n_wafers: number;
    n_risk: number;
    risk_ratio: number;
    mean_pred: number;
    max_pred: number;
  };
  wafers: {
    wafer_key: string;
    wafer_no: string;
    n_units: number;
    n_risk: number;
    mean_pred: number;
    max_pred: number;
    risk_ratio: number;
  }[];
}

export const fetchLots = (params: { split?: Split; sort?: string; limit?: number }) =>
  api.get<LotsResponse>("/api/lots", { params }).then((r) => r.data);

export const fetchLotDetail = (runId: string, split: Split) =>
  api.get<LotDetail>(`/api/lots/${runId}`, { params: { split } }).then((r) => r.data);

export const fetchTriage = (params: {
  split?: Split;
  top_units?: number;
  top_wafers?: number;
  unit_cost?: number;
}) =>
  api.get<TriageResponse>("/api/triage", { params }).then((r) => r.data);

export interface UnitReport {
  ufs_serial: string;
  verdict: "WARNING" | "NORMAL";
  is_risk: boolean;
  pred: number;
  health: number | null;
  split: Split;
  wafer_key: string;
  pred_rank: number;
  threshold: number;
  pi_mean: number;
  mu_mean: number;
  worst_die: {
    run_wf_xy: string;
    die_x: number;
    die_y: number;
    pi: number;
    mu: number;
    pred: number;
  } | null;
  narrative: string[];
}

export const fetchUnitReport = (ufsSerial: string) =>
  api
    .get<UnitReport>(`/api/units/${ufsSerial}/report`)
    .then((r) => r.data);
