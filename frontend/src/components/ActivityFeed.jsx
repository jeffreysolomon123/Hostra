import {
  Circle,
  CircleCheck,
  CircleX,
  KeyRound,
  Play,
  RotateCcw,
  Rocket,
  Settings,
  Square,
  TriangleExclamationPoint,
} from "lucide-react";
import { useNow } from "../hooks/useNow";
import { timeAgo } from "../lib/format";
import { Skeleton } from "./ui";

const ICONS = {
  deploy_queued: { icon: Rocket, cls: "text-muted" },
  deploy_live: { icon: CircleCheck, cls: "text-green-400" },
  deploy_failed: { icon: CircleX, cls: "text-red-400" },
  restart: { icon: RotateCcw, cls: "text-amber-400" },
  crash_loop: { icon: TriangleExclamationPoint, cls: "text-red-400" },
  stopped: { icon: Square, cls: "text-muted" },
  started: { icon: Play, cls: "text-green-400" },
  status: { icon: Circle, cls: "text-amber-400" },
  env_changed: { icon: KeyRound, cls: "text-muted" },
  settings: { icon: Settings, cls: "text-muted" },
};

export function ActivityFeed({ events, loading }) {
  const now = useNow();
  if (loading) {
    return (
      <div className="space-y-3 p-5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    );
  }
  if (!events?.length) return <p className="p-5 text-sm text-muted">No activity yet.</p>;
  return (
    <ol className="divide-y divide-line">
      {events.map((e) => {
        const { icon: Icon, cls } = ICONS[e.type] || ICONS.status;
        return (
          <li key={e.id} className="flex gap-3 px-5 py-3">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cls}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm break-words">{e.message}</p>
              <time className="text-xs text-faint" dateTime={e.created_at} title={new Date(e.created_at).toLocaleString()}>
                {timeAgo(e.created_at, now)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
