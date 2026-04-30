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
    <div className="flex items-end justify-between mb-2 px-1">
      <div>
        <h1 className="text-[16px] font-bold text-black leading-tight">{title}</h1>
        {subtitle && <p className="text-[11px] text-slate-700 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {right}
        {split && onSplitChange && (
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-slate-700">Split:</span>
            <select
              value={split}
              onChange={(e) => onSplitChange(e.target.value as Split)}
              className="border border-slate-500 bg-white text-[11px] px-1 py-0.5"
            >
              {SPLITS.map((sp) => (
                <option key={sp} value={sp}>
                  {sp}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
