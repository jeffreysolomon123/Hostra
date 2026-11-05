import { Eye, EyeOff, KeyRound, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { toast } from "sonner";
import { Button, Card, CopyButton, EmptyState, Field, Input, Modal, Skeleton } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { api } from "../../lib/api";
import { parseDotEnv } from "../../lib/format";

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function EditModal({ initial, onClose, onSave }) {
  const [key, setKey] = useState(initial?.key || "");
  const [value, setValue] = useState(initial?.value || "");
  const [busy, setBusy] = useState(false);
  const keyError = key && !KEY_RE.test(key) ? "Letters, digits and _, not starting with a digit" : null;
  async function submit(e) {
    e.preventDefault();
    if (!key || keyError) return;
    setBusy(true);
    const ok = await onSave({ [key]: value });
    setBusy(false);
    if (ok) onClose();
  }
  return (
    <Modal open onClose={onClose} title={initial ? `Edit ${initial.key}` : "Add variable"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Key" htmlFor="env-key" error={keyError}>
          <Input id="env-key" data-autofocus={initial ? undefined : true} value={key} disabled={Boolean(initial)}
            onChange={(e) => setKey(e.target.value.toUpperCase())} className="font-mono text-[13px]" placeholder="API_KEY" />
        </Field>
        <Field label="Value" htmlFor="env-value">
          <Input id="env-value" data-autofocus={initial ? true : undefined} value={value}
            onChange={(e) => setValue(e.target.value)} className="font-mono text-[13px]" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!key || Boolean(keyError)}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function BulkModal({ onClose, onSave }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const { vars, errors } = parseDotEnv(text);
  const count = Object.keys(vars).length;
  async function submit(e) {
    e.preventDefault();
    if (errors.length || !count) return;
    setBusy(true);
    const ok = await onSave(vars);
    setBusy(false);
    if (ok) onClose();
  }
  return (
    <Modal open onClose={onClose} title="Paste .env" description="Existing keys are overwritten, others are kept.">
      <form onSubmit={submit} className="space-y-3">
        <textarea data-autofocus aria-label=".env contents" rows={8} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"# comments are ignored\nDATABASE_URL=postgres://...\nexport DEBUG=false"}
          className="w-full rounded-md border border-line bg-surface-2 p-3 font-mono text-[13px] placeholder:text-faint focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/10" />
        {errors.slice(0, 3).map((e) => <p key={e} className="text-[13px] text-red-400">{e}</p>)}
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-[13px] text-muted">{count} variable{count === 1 ? "" : "s"}</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!count || errors.length > 0}>Import</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Environment() {
  const { app, reload: reloadApp } = useOutletContext();
  const env = useApi(`/apps/${app.name}/env`);
  const [revealed, setRevealed] = useState({}); // key -> plain value (only in memory, never stored)
  const [editing, setEditing] = useState(null); // null | "new" | {key, value}
  const [bulk, setBulk] = useState(false);
  const [deleting, setDeleting] = useState(null);

  async function save(vars) {
    try {
      env.setData(await api(`/apps/${app.name}/env`, { method: "PUT", json: { vars } }));
      setRevealed((r) => ({ ...r, ...Object.fromEntries(Object.keys(vars).map((k) => [k, undefined])) }));
      toast.success(`Saved ${Object.keys(vars).length} variable${Object.keys(vars).length === 1 ? "" : "s"}. Redeploy to apply.`);
      reloadApp();
      return true;
    } catch (err) {
      toast.error(err.message);
      return false;
    }
  }

  async function reveal(key) {
    if (revealed[key] !== undefined) return setRevealed((r) => ({ ...r, [key]: undefined }));
    try {
      const { value } = await api(`/apps/${app.name}/env/${encodeURIComponent(key)}/reveal`);
      setRevealed((r) => ({ ...r, [key]: value }));
      return value;
    } catch (err) {
      toast.error(err.message);
      return null;
    }
  }

  async function edit(key) {
    const value = revealed[key] ?? (await api(`/apps/${app.name}/env/${encodeURIComponent(key)}/reveal`).then((r) => r.value).catch(() => ""));
    setEditing({ key, value });
  }

  async function remove(key) {
    try {
      env.setData(await api(`/apps/${app.name}/env/${encodeURIComponent(key)}`, { method: "DELETE" }));
      toast.success(`Removed ${key}. Redeploy to apply.`);
      reloadApp();
    } catch (err) {
      toast.error(err.message);
    }
    setDeleting(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Encrypted at rest. Changes apply on the next deployment.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setBulk(true)}>
            <Upload className="h-3.5 w-3.5" aria-hidden /> Paste .env
          </Button>
          <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add variable
          </Button>
        </div>
      </div>

      {env.loading ? (
        <Skeleton className="h-40" />
      ) : !env.data?.length ? (
        <EmptyState icon={KeyRound} title="No environment variables"
          description="Add API keys, database URLs and other config. They are injected into the container at start." />
      ) : (
        <Card className="divide-y divide-line">
          {env.data.map((v) => {
            const plain = revealed[v.key];
            return (
              <div key={v.key} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                <span className="font-mono text-[13px] font-medium sm:w-2/5 sm:truncate">{v.key}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-muted">
                  {plain !== undefined ? plain || <em className="text-faint">(empty)</em> : v.value}
                </span>
                <div className="flex shrink-0 gap-1 self-end sm:self-auto">
                  <Button size="icon" variant="ghost" onClick={() => reveal(v.key)}
                    aria-label={plain !== undefined ? `Hide ${v.key}` : `Reveal ${v.key}`}>
                    {plain !== undefined ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  {plain !== undefined && <CopyButton value={plain} label={`Copy ${v.key}`} className="h-8 w-8" />}
                  <Button size="icon" variant="ghost" onClick={() => edit(v.key)} aria-label={`Edit ${v.key}`}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setDeleting(v.key)} aria-label={`Delete ${v.key}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {editing && <EditModal initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={save} />}
      {bulk && <BulkModal onClose={() => setBulk(false)} onSave={save} />}
      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title={`Delete ${deleting}?`}
          description="The running container keeps the old value until you redeploy."
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => remove(deleting)}>Delete</Button>
            </>
          } />
      )}
    </div>
  );
}
