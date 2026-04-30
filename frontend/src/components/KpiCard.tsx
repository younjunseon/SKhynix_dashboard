interface Props {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger" | "warn" | "info";
}

const toneColor = {
  default: "text-black",
  danger: "text-sf-danger",
  warn: "text-sf-warn",
  info: "text-sf-blue",
};

export default function KpiCard({ label, value, hint, tone = "default" }: Props) {
  return (
    <div className="panel flex flex-col">
      <div className="panel-title text-[11px]">{label}</div>
      <div className="panel-body p-2">
        <div className={`tabular text-[20px] font-bold leading-tight ${toneColor[tone]}`}>
          {value}
        </div>
        {hint && <div className="text-[10px] text-slate-600 mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}
