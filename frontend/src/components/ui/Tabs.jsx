import { NavLink } from "react-router-dom";
import { cn } from "../../lib/format";

/** Route-based tabs: each tab is a link, so they work with the keyboard, back button and new tabs. */
export function Tabs({ tabs }) {
  return (
    <nav aria-label="Project sections" className="-mb-px flex gap-1 overflow-x-auto">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 border-b-2 px-3 pb-3 pt-1 text-sm whitespace-nowrap transition-colors duration-150",
              "rounded-t focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
              isActive ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"
            )
          }
        >
          {t.icon && <t.icon className="h-4 w-4" aria-hidden />}
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Segmented control for in-page choices (e.g. 15m / 1h). */
export function Segmented({ value, onChange, options, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded px-3 py-1 text-[13px] transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
            value === o.value ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
