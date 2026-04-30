import type { ReactNode } from "react";

interface Props {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger" | "warn" | "info" | "accent";
  icon?: ReactNode;
}

export default function KpiCard({ label, value, hint, tone = "default", icon }: Props) {
  const isAccent = tone === "accent";
  const valueClass = isAccent
    ? "text-white"
    : tone === "danger"
    ? "text-brand-danger"
    : tone === "warn"
    ? "text-brand-warn"
    : tone === "info"
    ? "text-brand-primary"
    : "text-brand-text";

  return (
    <div className={isAccent ? "panel-accent" : "panel"}>
      <div className="px-5 pt-4 pb-1 flex items-center justify-between">
        <div
          className={`text-[12px] font-medium ${
            isAccent ? "text-white/80" : "text-brand-textMuted"
          }`}
        >
          {label}
        </div>
        {icon && (
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center ${
              isAccent ? "bg-white/15 text-white" : "bg-brand-subtle text-brand-primary"
            }`}
          >
            {icon}
          </div>
        )}
      </div>
      <div className="px-5 pb-4">
        <div className={`tabular text-[26px] font-bold leading-tight ${valueClass}`}>{value}</div>
        {hint && (
          <div
            className={`text-[11px] mt-1 ${
              isAccent ? "text-white/65" : "text-brand-textMuted"
            }`}
          >
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}
