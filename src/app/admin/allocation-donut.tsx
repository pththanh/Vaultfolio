import {
  classColor,
  classLabel,
  type AllocationClass,
} from "@/components/vf/ui";
import { formatPct, formatShortVnd } from "@/lib/format";

const R = 60;
const C = 2 * Math.PI * R;
const GAP = 1;

export function AllocationDonut({
  parts,
  total,
}: {
  parts: { cls: AllocationClass; share: number }[];
  total: bigint;
}) {
  const visible = parts.filter((p) => p.share > 0);
  const offsets = visible.map((_, i) =>
    visible.slice(0, i).reduce((sum, p) => sum + p.share * C, 0),
  );
  const label = `Phân bổ: ${visible.map((p) => `${classLabel[p.cls].toLowerCase()} ${formatPct(p.share, { digits: 1 })}`).join(", ")}`;

  return (
    <div className="relative flex justify-center">
      <svg
        role="img"
        aria-label={label}
        width="200"
        height="200"
        viewBox="0 0 160 160"
      >
        <circle
          cx="80"
          cy="80"
          r={R}
          fill="none"
          stroke="#EEF0EC"
          strokeWidth="22"
        />
        <g transform="rotate(-90 80 80)" fill="none" strokeWidth="22">
          {visible.map((p, i) => {
            const len = Math.max(
              p.share * C - (visible.length > 1 ? GAP : 0),
              0,
            );
            return (
              <circle
                key={p.cls}
                cx="80"
                cy="80"
                r={R}
                stroke={classColor[p.cls]}
                strokeDasharray={`${len} ${C}`}
                strokeDashoffset={-offsets[i]}
              />
            );
          })}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span className="text-xs text-subtle">{visible.length} loại</span>
        <span className="text-lg font-bold num">{formatShortVnd(total)}</span>
      </div>
    </div>
  );
}
