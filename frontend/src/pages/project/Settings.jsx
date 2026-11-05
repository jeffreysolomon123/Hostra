import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { toast } from "sonner";
import { DeleteAppModal } from "../../components/DeleteAppModal";
import { Button, Card, CardHeader, CopyButton, Field, Input, Skeleton, Toggle } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { api } from "../../lib/api";
import { LimitsList } from "./Overview";

function CopyField({ label, value, secret }) {
  const [show, setShow] = useState(!secret);
  return (
    <Field label={label}>
      <div className="flex items-center gap-1 rounded-md border border-line bg-surface-2 py-1 pl-3 pr-1">
        <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{show ? value : "•".repeat(32)}</code>
        {secret && (
          <Button size="sm" variant="ghost" onClick={() => setShow((s) => !s)}>
            {show ? "Hide" : "Show"}
          </Button>
        )}
        <CopyButton value={value} label={`Copy ${label}`} />
      </div>
    </Field>
  );
}

export default function Settings() {
  const { app, reload } = useOutletContext();
  const navigate = useNavigate();
  const webhook = useApi(`/apps/${app.name}/webhook`);
  const [branch, setBranch] = useState(app.branch || "");
  const [port, setPort] = useState(app.port_override ? String(app.port_override) : "");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function patch(body, message) {
    try {
      await api(`/apps/${app.name}`, { method: "PATCH", json: body });
      toast.success(message);
      reload();
      webhook.reload();
      return true;
    } catch (err) {
      toast.error(err.message);
      return false;
    }
  }

  async function saveBuild(e) {
    e.preventDefault();
    setSaving(true);
    await patch({ branch: branch.trim() || null, port: port ? Number(port) : null }, "Settings saved. They apply on the next deployment.");
    setSaving(false);
  }

  async function deleteApp() {
    try {
      await api(`/apps/${app.name}`, { method: "DELETE" });
      toast.success(`${app.name} deleted`);
      navigate("/");
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Build & source" description="Used by the next deployment." />
        <form onSubmit={saveBuild} className="space-y-5 p-5">
          <Field label="Repository">
            <Input value={app.repo_url} readOnly className="font-mono text-[13px] text-muted" />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Branch" htmlFor="set-branch" hint="Empty = the repo's default branch">
              <Input id="set-branch" value={branch} onChange={(e) => setBranch(e.target.value)} className="font-mono text-[13px]" />
            </Field>
            <Field label="Container port" htmlFor="set-port" hint={`Empty = auto-detect (currently ${app.port})`}>
              <Input id="set-port" inputMode="numeric" value={port} placeholder="auto"
                onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} className="font-mono text-[13px]" />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="sm" loading={saving}>Save</Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Auto-deploy"
          description={`Redeploy on every push to ${app.branch || "the default branch"}.`}
          action={
            <Toggle checked={app.auto_deploy} label="Auto-deploy on push"
              onChange={(on) => patch({ auto_deploy: on }, on ? "Auto-deploy enabled" : "Auto-deploy disabled")} />
          }
        />
        <div className="space-y-4 p-5">
          {webhook.loading ? (
            <Skeleton className="h-28" />
          ) : !webhook.data?.enabled ? (
            <p className="text-sm text-amber-300">Webhooks are disabled on this server (GITHUB_WEBHOOK_SECRET is not set).</p>
          ) : (
            <>
              <CopyField label="Payload URL" value={webhook.data.url} />
              <CopyField label="Secret" value={webhook.data.secret} secret />
              <div className="rounded-md border border-line bg-surface-2 p-4 text-[13px] text-muted">
                <p className="mb-2 font-medium text-fg">Set up on GitHub</p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Open your repository → <b className="text-fg">Settings</b> → <b className="text-fg">Webhooks</b> → <b className="text-fg">Add webhook</b>.</li>
                  <li>Paste the <b className="text-fg">Payload URL</b> and set content type to <code className="font-mono text-fg">application/json</code>.</li>
                  <li>Paste the <b className="text-fg">Secret</b>. Choose <b className="text-fg">Just the push event</b>.</li>
                  <li>GitHub cannot reach <code className="font-mono">localhost</code>: expose the API with a tunnel (Cloudflare Tunnel or smee.io, see the README) and set PUBLIC_API_URL.</li>
                </ol>
              </div>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Resource limits" description="Fixed for every container on this platform." />
        <LimitsList limits={app.limits} />
      </Card>

      <Card className="border-err/30">
        <CardHeader title="Danger zone" className="border-err/20" />
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            Delete this project, its container, image, deployments, metrics and environment variables.
          </p>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" aria-hidden /> Delete project
          </Button>
        </div>
      </Card>
      <DeleteAppModal name={app.name} open={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={deleteApp} />
    </div>
  );
}
