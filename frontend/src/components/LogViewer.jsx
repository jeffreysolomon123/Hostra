import { ArrowDown, Download, Search, TextWrap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/format";
import { Button, inputClass, LiveIndicator } from "./ui";

/**
 * Terminal-style log pane used for runtime logs and build logs.
 * - auto-scrolls to the newest line, but PAUSES when you scroll up to read
 *   ("Jump to latest" resumes)
 * - search filter, wrap toggle, download as .log
 */
export function LogViewer({ lines, status, filename = "logs.log", emptyText = "No output yet.", height = "h-[calc(100vh-26rem)] min-h-72" }) {
  const [query, setQuery] = useState("");
  const [wrap, setWrap] = useState(true);
  const [follow, setFollow] = useState(true);
  const boxRef = useRef(null);

  const shown = useMemo(() => {
    // strip terminal color codes (ESC[31m ...) that apps print for real terminals
    // eslint-disable-next-line no-control-regex
    const clean = lines.map((l) => l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ""));
    if (!query) return clean;
    const q = query.toLowerCase();
    return clean.filter((l) => l.toLowerCase().includes(q));
  }, [lines, query]);

  useEffect(() => {
    if (follow && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [shown, follow, wrap]);

  function onScroll() {
    const el = boxRef.current;
    // within 24px of the bottom counts as "at the bottom"
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== follow) setFollow(atBottom);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-[#0c0c0c]">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        {status && <LiveIndicator status={status} className="mr-1" />}
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter logs"
            aria-label="Filter logs"
            className={cn(inputClass, "h-8 pl-8 font-mono text-xs")}
          />
        </div>
        {query && (
          <span className="text-xs text-faint">
            {shown.length}/{lines.length}
          </span>
        )}
        <Button
          size="sm"
          variant={wrap ? "secondary" : "ghost"}
          onClick={() => setWrap((w) => !w)}
          aria-pressed={wrap}
          title="Wrap long lines"
        >
          <TextWrap className="h-3.5 w-3.5" aria-hidden /> Wrap
        </Button>
        <Button size="sm" variant="ghost" onClick={download} disabled={!lines.length} title="Download">
          <Download className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">Download</span>
        </Button>
      </div>
      <div className="relative">
        <div
          ref={boxRef}
          onScroll={onScroll}
          role="log"
          aria-live="off"
          tabIndex={0}
          className={cn(
            "overflow-auto px-4 py-3 font-mono text-[12.5px] leading-[1.6] text-zinc-300 focus-visible:outline-none",
            height
          )}
        >
          {shown.length === 0 ? (
            <p className="text-faint">{query ? "No lines match the filter." : emptyText}</p>
          ) : (
            shown.map((line, i) => (
              <div
                key={i}
                className={cn(
                  wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre",
                  line.startsWith("==>") && "font-medium text-fg",
                  /^==> ERROR|error:|Traceback/i.test(line) && "text-red-400",
                  line.startsWith("---") && "text-amber-400/80"
                )}
              >
                {line || " "}
              </div>
            ))
          )}
        </div>
        {!follow && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setFollow(true)}
            className="absolute bottom-3 right-4 shadow-lg"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden /> Jump to latest
          </Button>
        )}
      </div>
    </div>
  );
}
