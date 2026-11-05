import { Loader2 } from "lucide-react";
import { cn } from "../../lib/format";

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

const VARIANTS = {
  primary: "bg-fg text-black hover:bg-white border border-transparent",
  secondary: "bg-surface-2 text-fg border border-line hover:border-line-strong hover:bg-[#1e1e1e]",
  ghost: "text-muted hover:text-fg hover:bg-white/5 border border-transparent",
  danger: "bg-err/10 text-red-400 border border-err/30 hover:bg-err/20 hover:text-red-300",
};

const SIZES = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  icon: "h-8 w-8 justify-center",
};

/** <Button variant="primary|secondary|ghost|danger" size="sm|md|icon" loading as={Link} /> */
export function Button({
  as: Component = "button",
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...props
}) {
  const extra = Component === "button" ? { type: props.type || "button", disabled: disabled || loading } : {};
  return (
    <Component
      className={cn(
        "inline-flex shrink-0 items-center rounded-md font-medium whitespace-nowrap transition-colors duration-150",
        "disabled:pointer-events-none disabled:opacity-50",
        focusRing,
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
      {...extra}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {children}
    </Component>
  );
}
