import { Rocket } from "lucide-react";
import { Link, useOutletContext } from "react-router-dom";
import { Badge, Button, Card, EmptyState, Skeleton, StatusLabel } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { useNow } from "../../hooks/useNow";
import { useLiveReload } from "../../lib/events";
import { formatDuration, shortSha, timeAgo } from "../../lib/format";

export default function Deployments() {
  const { app, actions } = useOutletContext();
  const list = useApi(`/apps/${app.name}/deployments`);
  useLiveReload(list.reload, app.name);
  const now = useNow(10_000);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted">The last 50 deployments, newest first.</p>
        <Button size="sm" variant="primary" onClick={() => actions.redeploy(app.name, { open: true })}>
          <Rocket className="h-3.5 w-3.5" aria-hidden /> Redeploy
        </Button>
      </div>
      {list.loading ? (
        <Skeleton className="h-48" />
      ) : !list.data?.length ? (
        <EmptyState icon={Rocket} title="No deployments yet" />
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {list.data.map((d) => (
            <Link
              key={d.id}
              to={String(d.id)}
              className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-4 transition-colors duration-150 hover:bg-white/[0.025] focus-visible:bg-white/[0.04] focus-visible:outline-none md:grid-cols-[7rem_1fr_6rem_5rem_8rem]"
            >
              <StatusLabel status={d.status} kind="deploy" />
              <span className="col-span-2 row-start-2 min-w-0 truncate text-sm md:col-span-1 md:row-start-auto">
                <span className="mr-2 font-mono text-[13px] text-muted">#{d.id}</span>
                <span className="mr-2 font-mono text-[13px] text-muted">{shortSha(d.commit_sha)}</span>
                {d.commit_message || (d.status === "queued" ? "Waiting for a build slot…" : "—")}
              </span>
              <span className="hidden md:block">
                <Badge>{d.trigger}</Badge>
              </span>
              <span className="hidden text-right text-[13px] tabular-nums text-muted md:block">{formatDuration(d.duration_s)}</span>
              <span className="text-right text-[13px] text-muted">{timeAgo(d.created_at, now)}</span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
