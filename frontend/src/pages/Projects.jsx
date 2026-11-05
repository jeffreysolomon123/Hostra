import {
  ExternalLink,
  GitBranch,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Rocket,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DeleteAppModal } from "../components/DeleteAppModal";
import { GithubIcon } from "../components/icons";
import { Badge, Button, Card, CopyButton, Dropdown, EmptyState, inputClass, Skeleton, StatusLabel } from "../components/ui";
import { useApi } from "../hooks/useApi";
import { useAppActions } from "../hooks/useAppActions";
import { useNow } from "../hooks/useNow";
import { useLiveReload } from "../lib/events";
import { cn, formatMb, parseRepo, timeAgo } from "../lib/format";

const FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "running", label: "Running" },
  { value: "building", label: "Building" },
  { value: "failed", label: "Failed / crashed" },
  { value: "stopped", label: "Stopped" },
];

function matchesFilter(app, filter) {
  if (filter === "all") return true;
  if (filter === "failed") return ["failed", "crashed", "unhealthy"].includes(app.status);
  if (filter === "stopped") return ["stopped", "missing"].includes(app.status);
  return app.status === filter;
}

function StatsStrip({ overview }) {
  const stats = [
    { label: "Projects", value: overview?.apps },
    { label: "Running", value: overview?.running },
    { label: "CPU", value: overview && `${overview.cpu_percent.toFixed(1)}%` },
    { label: "Memory", value: overview && formatMb(overview.mem_mb) },
  ];
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-line gap-px md:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="bg-surface px-5 py-4">
          <dt className="text-xs text-muted">{s.label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
            {s.value ?? <Skeleton className="h-7 w-14" />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ProjectCard({ app, actions, onDelete, now }) {
  const navigate = useNavigate();
  const repo = parseRepo(app.repo_url);
  const host = app.url.replace(/^https?:\/\//, "");
  const isRunning = app.status === "running" || app.status === "unhealthy";

  return (
    <Card className="group relative flex flex-col gap-4 p-5 transition-colors duration-150 hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* "stretched link": the whole card is clickable, inner buttons sit above it (z-10) */}
          <Link
            to={`/projects/${app.name}`}
            className="block truncate font-semibold after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-white/50"
          >
            {app.name}
          </Link>
          <p className="mt-1 flex items-center gap-1.5 truncate text-[13px] text-muted">
            <GithubIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{repo ? `${repo.owner}/${repo.repo}` : app.repo_url}</span>
          </p>
        </div>
        <div className="relative z-10">
          <Dropdown
            items={[
              { label: "Open", icon: ExternalLink, onSelect: () => navigate(`/projects/${app.name}`) },
              { label: "Visit", icon: ExternalLink, onSelect: () => window.open(app.url, "_blank", "noopener") },
              { label: "Redeploy", icon: Rocket, onSelect: () => actions.redeploy(app.name) },
              isRunning
                ? { label: "Stop", icon: Square, onSelect: () => actions.stop(app.name) }
                : { label: "Start", icon: Play, onSelect: () => actions.start(app.name), disabled: app.status === "missing" || app.status === "building" },
              "separator",
              { label: "Delete…", icon: Trash2, danger: true, onSelect: () => onDelete(app.name) },
            ]}
            trigger={(props) => (
              <Button {...props} variant="ghost" size="icon" aria-label={`Actions for ${app.name}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            )}
          />
        </div>
      </div>

      <div className="relative z-10 flex min-w-0 items-center gap-1 self-start">
        {app.restart_count > 0 && (
          <Badge tone="warn" className="mr-2">
            <RotateCcw className="h-3 w-3" aria-hidden />
            {app.restart_count} restart{app.restart_count === 1 ? "" : "s"}
          </Badge>
        )}
        <a
          href={app.url}
          target="_blank"
          rel="noreferrer"
          className="truncate rounded font-mono text-[12.5px] text-muted hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          {host}
        </a>
        <CopyButton value={app.url} label="Copy URL" />
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4 text-[13px] text-muted">
        <StatusLabel status={app.status} className="text-[13px] text-fg" />
        {app.branch && (
          <span className="flex items-center gap-1">
            <GitBranch className="h-3.5 w-3.5" aria-hidden />
            {app.branch}
          </span>
        )}
        {/* v1 apps have no deployment rows yet: fall back to when they were created */}
        <span className="ml-auto">{timeAgo(app.last_deployed_at || app.created_at, now)}</span>
      </div>
    </Card>
  );
}

export default function Projects() {
  const apps = useApi("/apps");
  const overview = useApi("/system/overview", { interval: 5000 });
  const actions = useAppActions(() => {
    apps.reload();
    overview.reload();
  });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [deleting, setDeleting] = useState(null);
  const now = useNow();

  // live: any status/deployment/restart event for this user refreshes the list
  useLiveReload(() => {
    apps.reload();
    overview.reload();
  });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (apps.data || []).filter(
      (a) => matchesFilter(a, filter) && (!q || a.name.includes(q) || a.repo_url.toLowerCase().includes(q))
    );
  }, [apps.data, query, filter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted">Every app you deployed, live.</p>
        </div>
      </div>

      <StatsStrip overview={overview.data} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            aria-label="Search projects"
            className={cn(inputClass, "pl-9")}
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter by status"
          className={cn(inputClass, "sm:w-48")}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {apps.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : apps.error ? (
        <EmptyState title="Could not load projects" description={apps.error.message}
          action={<Button onClick={apps.reload}>Try again</Button>} />
      ) : apps.data.length === 0 ? (
        <EmptyState
          icon={Rocket}
          title="No projects yet"
          description="Import a GitHub repository with a Dockerfile and Hostra builds, runs and routes it for you."
          action={
            <Button as={Link} to="/new" variant="primary">
              <Plus className="h-4 w-4" aria-hidden /> New Project
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState icon={Search} title="No matching projects" description="Try a different search or status filter." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((a) => (
            <ProjectCard key={a.name} app={a} actions={actions} onDelete={setDeleting} now={now} />
          ))}
        </div>
      )}

      {deleting && (
        <DeleteAppModal
          name={deleting}
          open
          onClose={() => setDeleting(null)}
          onConfirm={() => actions.remove(deleting)}
        />
      )}
    </div>
  );
}
