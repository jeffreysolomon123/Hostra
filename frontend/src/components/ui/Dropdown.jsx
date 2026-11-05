import { useEffect, useId, useRef, useState } from "react";
import { cn } from "../../lib/format";

/**
 * Keyboard-friendly menu (WAI-ARIA menu button pattern):
 * Enter/Space/ArrowDown opens and focuses the first item, arrows move,
 * Home/End jump, Escape closes and returns focus to the button, Tab closes.
 *
 * items: [{ label, icon, onSelect, danger, disabled }] or "separator"
 * trigger: (props) => <Button {...props}>...</Button>
 */
export function Dropdown({ trigger, items, header, align = "right" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuId = useId();

  const itemEls = () => [...(rootRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])];

  useEffect(() => {
    if (!open) return undefined;
    itemEls()[0]?.focus();
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function onMenuKey(e) {
    const els = itemEls();
    const i = els.indexOf(document.activeElement);
    const moves = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: els.length - 1 };
    if (e.key in moves) {
      e.preventDefault();
      els[(moves[e.key] + els.length) % els.length]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      {trigger({
        ref: buttonRef,
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": menuId,
        onClick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        },
        onKeyDown: (e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        },
      })}
      {open && (
        <div
          id={menuId}
          role="menu"
          onKeyDown={onMenuKey}
          className={cn(
            "absolute z-40 mt-1.5 min-w-48 rounded-lg border border-line bg-surface p-1 shadow-xl shadow-black/40",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {header && <div className="border-b border-line px-2.5 pb-2 pt-1.5 mb-1 text-xs text-muted">{header}</div>}
          {items.map((item, i) =>
            item === "separator" ? (
              <div key={i} className="my-1 h-px bg-line" role="separator" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-150",
                  "outline-none focus:bg-white/[0.07] hover:bg-white/[0.07] disabled:opacity-40",
                  item.danger ? "text-red-400" : "text-fg"
                )}
              >
                {item.icon && <item.icon className="h-4 w-4 opacity-70" aria-hidden />}
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
