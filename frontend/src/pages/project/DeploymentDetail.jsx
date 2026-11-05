import { ArrowLeft, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { LogViewer } from "../../components/LogViewer";
import { Badge, Button, Card, StatusLabel } from "../../components/ui";
import { useWebSocket } from "../../hooks/useWebSocket";
import { api } from "../../lib/api";
import { formatDuration, shortSha } from "../../lib/format";

/** Live build log: snapshot + streamed lines over WebSocket, REST polling while it is down. */
export default function DeploymentDetail() {
  const { app } = useOutletContext();
  const { id } = useParams();
  const [lines, setLines] = useState([]);
  const [dep, setDep] = useState(null);
  const [error, setError] = useState(null);

  const status = useWebSocket(`/ws/deployments/${id}/build`, (msg) => {
    if (msg.type === "snapshot") {
      setLines(msg.lines);
      setDep(msg.deployment);
    } else if (msg.type === "log") {
      setLines((prev) => [...prev, msg.line]);
    } else if (msg.type === "deployment") {
      setDep((prev) => ({ ...prev, ...msg.deployment }));
    }
  });

  // Fallback: socket down (not "finished normally") -> poll the REST endpoint.
  // A boolean dependency, so updating `dep` does not restart the interval.
  const needFallback = status === "reconnecting" || (status === "closed" && !dep);
  useEffect(() => {
    if (!needFallback) return undefined;
    let stop = false;
    async function poll() {
      try {
        const d = await api(`/deployments/${id}`);
        if (stop) return;
        setDep(d);
        setLines(d.log);
      } catch (err) {
        if (!stop) setError(err);
      }
    }
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id, needFallback]);

  if (error?.status === 404) {
    return <p className="text-sm text-muted">Deployment #{id} not found.</p>;
  }
  const finished = dep && ["live", "failed"].includes(dep.status);

  return (
    <div className="space-y-4">
      <Link to=".." relative="path" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Deployments
      </Link>
      <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
        <div>
          <p className="text-xs text-muted">Deployment</p>
          <p className="font-mono text-sm">#{id}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Status</p>
          {dep ? <StatusLabel status={dep.status} kind="deploy" /> : <span className="text-sm text-muted">…</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">Commit</p>
          <p className="truncate text-sm">
            <span className="mr-2 font-mono text-[13px] text-muted">{shortSha(dep?.commit_sha)}</span>
            {dep?.commit_message || "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Trigger</p>
          {dep ? <Badge>{dep.trigger}</Badge> : "—"}
        </div>
        <div>
          <p className="text-xs text-muted">Duration</p>
          <p className="text-sm tabular-nums">{formatDuration(dep?.duration_s)}</p>
        </div>
        {dep?.status === "live" && (
          <Button as="a" href={app.url} target="_blank" rel="noreferrer" size="sm" variant="primary">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Visit
          </Button>
        )}
      </Card>
      {dep?.status === "failed" && dep.error && (
        <div role="alert" className="rounded-lg border border-err/30 bg-err/[0.07] px-4 py-3">
          <p className="text-sm font-medium text-red-300">Deployment failed. The previous version keeps running.</p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-red-200/80">{dep.error}</pre>
        </div>
      )}
      <LogViewer
        lines={lines}
        status={finished ? undefined : status}
        filename={`${app.name}-deployment-${id}.log`}
        emptyText={dep?.status === "queued" ? "Waiting for a build slot…" : "Starting…"}
      />
    </div>
  );
}
