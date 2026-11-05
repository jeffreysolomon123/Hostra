import { cn } from "../../lib/format";
import { appStatus, deployStatus } from "../../lib/status";

const TONES = {
  neutral: "border-line text-muted bg-surface-2",
  ok: "border-ok/30 text-green-400 bg-ok/10",
  warn: "border-warn/30 text-amber-400 bg-warn/10",
  err: "border-err/30 text-red-400 bg-err/10",
  info: "border-info/30 text-blue-400 bg-info/10",
};

export function Badge({ tone = "neutral", className, children }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/** Small colored dot with a soft glow. Pulses for in-progress states. */
export function StatusDot({ color, pulse = false, className }) {
  return (
    <span className={cn("relative inline-flex h-2 w-2 shrink-0", className)} aria-hidden>
      {pulse && (
        <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: color }} />
      )}
      <span className="relative h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
    </span>
  );
}

/** Dot + text label, so status is never conveyed by color alone. */
export function StatusLabel({ status, kind = "app", className }) {
  const s = kind === "app" ? appStatus(status) : deployStatus(status);
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm", className)}>
      <StatusDot color={s.color} pulse={s.pulse} />
      <span>{s.label}</span>
    </span>
  );
}
