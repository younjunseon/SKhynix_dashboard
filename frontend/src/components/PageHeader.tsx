import type { Split } from "../lib/api";

const SPLITS: Split[] = ["test", "val", "oof"];

interface Props {
  title: string;
  subtitle?: string;
  split?: Split;
  onSplitChange?: (s: Split) => void;
  right?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, split, onSplitChange, right }: Props) {
  return (
    <div className="flex items-end justify-between mb-5">
      <div>
        <h1 className="text-[20px] font-bold text-brand-text leading-tight">{title}</h1>
        {subtitle && <p className="text-[12px] text-brand-textMuted mt-1">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {right}
        {split && onSplitChange && (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-brand-textMuted">Split</span>
            <div className="inline-flex bg-white border border-brand-border rounded-lg overflow-hidden shadow-card">
              {SPLITS.map((sp) => (
                <button
                  key={sp}
                  onClick={() => onSplitChange(sp)}
                  className={`text-[12px] px-3 py-1.5 font-medium transition-colors ${
                    split === sp
                      ? "bg-brand-primary text-white"
                      : "text-brand-textMuted hover:bg-brand-subtle"
                  }`}
                >
                  {sp}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
