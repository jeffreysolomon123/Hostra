import { ArrowRight, Cpu, GitBranch, HardDrive, MemoryStick, RotateCcw } from "lucide-react";
import { Link, useOutletContext } from "react-router-dom";
import { ActivityFeed } from "../../components/ActivityFeed";
import { GithubIcon } from "../../components/icons";
import { Card, CardHeader, CopyButton, StatusLabel } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { useNow } from "../../hooks/useNow";
import { useLiveReload } from "../../lib/events";
import { formatDuration, parseRepo, shortSha, timeAgo } from "../../lib/format";

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 text-sm sm:text-right">{children}</dd>
    </div>
  );
}

export function LimitsList({ limits }) {
  const items = [
    { icon: MemoryStick, label: "Memory", value: limits.memory.replace("m", " MB") },
    { icon: Cpu, label: "CPU", value: `${limits.cpus} vCPU` },
    { icon: HardDrive, label: "Processes", value: `${limits.pids} max` },
  ];
  return (
    <ul className="grid grid-cols-3 divide-x divide-line">
      {items.map(({ icon: Icon, label, value }) => (
        <li key={label} className="px-4 py-4 text-center">
          <Icon className="mx-auto h-4 w-4 text-faint" aria-hidden />
          <p className="mt-2 text-sm font-medium tabular-nums">{value}</p>
          <p className="text-xs text-muted">{label}</p>
        </li>
      ))}
    </ul>
  );
}

export default function Overview() {
  const { app } = useOutletContext();
  const events = useApi(`/apps/${app.name}/events?limit=20`);
  useLiveReload(events.reload, app.name);
  const now = useNow();
  const repo = parseRepo(app.repo_url);
  const d = app.latest_deployment;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader title="Production" description="The container currently serving traffic." />
          <dl className="divide-y divide-line px-5">
            <Row label="Status">
              <StatusLabel status={app.status} />
            </Row>
            <Row label="Domain">
              <span className="flex items-center gap-1 sm:justify-end">
                <a href={app.url} target="_blank" rel="noreferrer" className="truncate font-mono text-[13px] hover:underline">
                  {app.url}
                </a>
                <CopyButton value={app.url} label="Copy URL" />
              </span>
            </Row>
            <Row label="Source">
              <span className="flex items-center gap-1.5 sm:justify-end">
                <GithubIcon className="h-3.5 w-3.5 text-muted" />
                <a href={app.repo_url} target="_blank" rel="noreferrer" className="truncate hover:underline">
                  {repo ? `${repo.owner}/${repo.repo}` : app.repo_url}
                </a>
                {app.branch && (
                  <span className="ml-2 inline-flex items-center gap-1 text-muted">
                    <GitBranch className="h-3.5 w-3.5" aria-hidden /> {app.branch}
                  </span>
                )}
              </span>
            </Row>
            <Row label="Container port">
              <span className="font-mono text-[13px]">{app.port}</span>
              <span className="ml-2 text-muted">{app.port_override ? "(set by you)" : "(auto-detected)"}</span>
            </Row>
            <Row label="Restarts">
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <RotateCcw className="h-3.5 w-3.5 text-muted" aria-hidden />
                {app.restart_count}
                {app.last_restart_at && <span className="text-muted">· last {timeAgo(app.last_restart_at, now)}</span>}
              </span>
            </Row>
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Latest deployment"
            action={
              <Link to="deployments" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
                All deployments <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            }
          />
          {d ? (
            <Link to={`deployments/${d.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 transition-colors duration-150 hover:bg-white/[0.02]">
              <StatusLabel status={d.status} kind="deploy" />
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="mr-2 font-mono text-[13px] text-muted">{shortSha(d.commit_sha)}</span>
                {d.commit_message || "—"}
              </span>
              <span className="text-[13px] text-muted">
                {d.trigger} · {formatDuration(d.duration_s)} · {timeAgo(d.created_at, now)}
              </span>
            </Link>
          ) : (
            <p className="px-5 py-4 text-sm text-muted">No deployments yet.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Resource limits" description="Applied to every container so one app cannot starve the host." />
          <LimitsList limits={app.limits} />
        </Card>
      </div>

      <Card className="self-start">
        <CardHeader title="Activity" />
        <ActivityFeed events={events.data} loading={events.loading} />
      </Card>
    </div>
  );
}
