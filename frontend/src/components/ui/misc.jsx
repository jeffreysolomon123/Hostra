import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/format";
import { focusRing } from "./Button";

export function Skeleton({ className }) {
  return <div className={cn("animate-pulse rounded-md bg-white/[0.06]", className)} aria-hidden />;
}

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-16 text-center",
        className
      )}
    >
      {Icon && (
        <div className="mb-4 rounded-full border border-line bg-surface p-3">
          <Icon className="h-5 w-5 text-muted" aria-hidden />
        </div>
      )}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function CopyButton({ value, label = "Copy", className }) {
  const [copied, setCopied] = useState(false);
  async function copy(e) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing useful to do */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={cn(
        "relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors duration-150 hover:bg-white/5 hover:text-fg",
        focusRing,
        className
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function Field({ label, htmlFor, hint, error, children, className }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-[13px] font-medium text-muted">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-[13px] text-red-400" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-[13px] text-faint">{hint}</p>
      )}
    </div>
  );
}

export const inputClass = cn(
  "h-9 w-full rounded-md border border-line bg-surface-2 px-3 text-sm text-fg placeholder:text-faint",
  "transition-colors duration-150 hover:border-line-strong",
  "focus:outline-none focus:border-white/40 focus:ring-2 focus:ring-white/10",
  "aria-[invalid=true]:border-err/60"
);

export function Input({ className, ...props }) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function Toggle({ checked, onChange, label, id, disabled }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:opacity-50",
        focusRing,
        checked ? "border-transparent bg-fg" : "border-line bg-surface-2"
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full transition-transform duration-150",
          checked ? "translate-x-[18px] bg-black" : "translate-x-[3px] bg-faint"
        )}
      />
    </button>
  );
}

/** "● Live" / "● Reconnecting…" for any WebSocket status. */
export function LiveIndicator({ status, className }) {
  const live = status === "live";
  const text = { live: "Live", connecting: "Connecting…", reconnecting: "Reconnecting…", closed: "Offline" }[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted", className)} aria-live="polite">
      <span
        className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-ok" : "bg-warn animate-pulse")}
        style={{ boxShadow: `0 0 6px ${live ? "var(--color-ok)" : "var(--color-warn)"}` }}
        aria-hidden
      />
      {text}
    </span>
  );
}
