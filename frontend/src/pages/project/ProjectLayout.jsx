import {
  ChartLine,
  ExternalLink,
  KeyRound,
  LayoutDashboard,
  Play,
  Rocket,
  Settings,
  Square,
  SquareTerminal,
} from "lucide-react";
import { Link, Outlet, useParams } from "react-router-dom";
import { Button, CopyButton, EmptyState, Skeleton, StatusLabel, Tabs } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { useAppActions } from "../../hooks/useAppActions";
import { useLiveReload } from "../../lib/events";

/** Loads the app once, keeps it live, and hands it to the tab pages via <Outlet context>. */
export default function ProjectLayout() {
  const { name } = useParams();
  const app = useApi(`/apps/${name}`);
  const actions = useAppActions(app.reload);
  useLiveReload(app.reload, name); // only events for THIS app

  if (app.loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-6 w-96 max-w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (app.error) {
    return (
      <EmptyState
        title={app.error.status === 404 ? "Project not found" : "Could not load project"}
        description={app.error.status === 404 ? `There is no project called "${name}" in your account.` : app.error.message}
        action={<Button as={Link} to="/">Back to projects</Button>}
      />
    );
  }

  const a = app.data;
  const base = `/projects/${name}`;
  const running = a.status === "running" || a.status === "unhealthy";
  const isBusy = (action) => actions.busy === `${name}:${action}`;

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{a.name}</h1>
            <StatusLabel status={a.status} className="rounded-full border border-line px-2.5 py-0.5 text-xs" />
          </div>
          <div className="mt-2 flex min-w-0 items-center gap-1">
            <a href={a.url} target="_blank" rel="noreferrer" className="truncate font-mono text-[13px] text-muted hover:text-fg hover:underline">
              {a.url.replace(/^https?:\/\//, "")}
            </a>
            <CopyButton value={a.url} label="Copy URL" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button as="a" href={a.url} target="_blank" rel="noreferrer" size="sm">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Visit
          </Button>
          {running ? (
            <Button size="sm" onClick={() => actions.stop(name)} loading={isBusy("stop")}>
              <Square className="h-3.5 w-3.5" aria-hidden /> Stop
            </Button>
          ) : (
            <Button size="sm" onClick={() => actions.start(name)} loading={isBusy("start")}
              disabled={a.status === "missing" || a.status === "building"}>
              <Play className="h-3.5 w-3.5" aria-hidden /> Start
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => actions.redeploy(name, { open: true })} loading={isBusy("redeploy")}>
            <Rocket className="h-3.5 w-3.5" aria-hidden /> Redeploy
          </Button>
        </div>
      </div>

      {a.needs_redeploy && (
        <div role="status" className="mt-6 flex flex-col gap-3 rounded-lg border border-warn/30 bg-warn/[0.07] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-amber-200">
            Environment variables changed since the last deployment. Redeploy to apply them.
          </p>
          <Button size="sm" onClick={() => actions.redeploy(name, { open: true })} loading={isBusy("redeploy")}>
            Redeploy now
          </Button>
        </div>
      )}

      <div className="mt-6 border-b border-line">
        <Tabs
          tabs={[
            { to: base, label: "Overview", icon: LayoutDashboard, end: true },
            { to: `${base}/deployments`, label: "Deployments", icon: Rocket },
            { to: `${base}/logs`, label: "Logs", icon: SquareTerminal },
            { to: `${base}/metrics`, label: "Metrics", icon: ChartLine },
            { to: `${base}/env`, label: "Environment", icon: KeyRound },
            { to: `${base}/settings`, label: "Settings", icon: Settings },
          ]}
        />
      </div>
      <div className="pt-6">
        <Outlet context={{ app: a, reload: app.reload, actions }} />
      </div>
    </div>
  );
}
