import { ArrowLeft, Check, Rocket } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { EnvEditor } from "../components/EnvEditor";
import { GithubIcon } from "../components/icons";
import { Button, Card, Field, Input, Toggle } from "../components/ui";
import { api } from "../lib/api";
import { APP_NAME_RE, parseRepo, slugify } from "../lib/format";

/**
 * Read the Dockerfile straight from GitHub (raw.githubusercontent.com allows CORS)
 * to show the port the backend will detect. Only a hint: the backend decides.
 */
function useDetectedPort(repo, branch) {
  const [result, setResult] = useState(null); // { port } | { error }
  const repoPath = repo ? `${repo.owner}/${repo.repo}` : null; // a string, so the effect deps are simple
  useEffect(() => {
    if (!repoPath) return undefined;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const ref = branch || "HEAD";
        const res = await fetch(`https://raw.githubusercontent.com/${repoPath}/${ref}/Dockerfile`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return setResult({ error: "No Dockerfile found in the repo root (or the repo is private)" });
        const m = /^\s*EXPOSE\s+(\d+)/im.exec(await res.text());
        setResult({ port: m ? Number(m[1]) : 8000, fromExpose: Boolean(m) });
      } catch {
        /* aborted or offline: no hint */
      }
    }, 400); // debounce while typing
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [repoPath, branch]);
  return repoPath ? result : null;
}

export default function NewProject() {
  const navigate = useNavigate();
  const [repoUrl, setRepoUrl] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [branch, setBranch] = useState("");
  const [port, setPort] = useState("");
  const [env, setEnv] = useState([]);
  const [autoDeploy, setAutoDeploy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");

  const repo = parseRepo(repoUrl);
  const detected = useDetectedPort(repo, branch.trim());
  // suggest the name from the repo until the user types their own
  const effectiveName = nameTouched ? name : repo ? slugify(repo.repo) : "";

  const errors = {
    repo: !repoUrl ? "Enter a GitHub repository URL" : !repo ? "Must look like https://github.com/owner/repo" : null,
    name: !APP_NAME_RE.test(effectiveName)
      ? "2–31 characters: lowercase letters, digits and single hyphens"
      : null,
    port: port && !(Number(port) >= 1 && Number(port) <= 65535) ? "Port must be 1–65535" : null,
    env: env.some((r) => r.key && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.key)) ? "Invalid variable name" : null,
  };
  const valid = !Object.values(errors).some(Boolean);
  const show = (field) => (submitted || (field === "repo" && repoUrl)) && errors[field];

  async function deploy(e) {
    e.preventDefault();
    setSubmitted(true);
    setServerError("");
    if (!valid) return;
    setBusy(true);
    try {
      const res = await api("/deploy", {
        method: "POST",
        json: {
          name: effectiveName,
          repo_url: repoUrl.trim(),
          branch: branch.trim() || null,
          port: port ? Number(port) : null,
          auto_deploy: autoDeploy,
          env: Object.fromEntries(env.filter((r) => r.key).map((r) => [r.key, r.value])),
        },
      });
      toast.success(`Deploying ${res.name}`);
      navigate(`/projects/${res.name}/deployments/${res.deployment_id}`);
    } catch (err) {
      setServerError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Projects
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">New Project</h1>
      <p className="mt-1 text-sm text-muted">
        Import a public GitHub repository with a <span className="font-mono text-fg">Dockerfile</span> in its root.
      </p>

      <form onSubmit={deploy} noValidate className="mt-8 space-y-6">
        <Card className="space-y-5 p-5 sm:p-6">
          <Field label="Repository URL" htmlFor="repo" error={show("repo")}>
            <div className="relative">
              <GithubIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <Input
                id="repo"
                autoFocus
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                aria-invalid={Boolean(show("repo"))}
                className="pl-9 font-mono text-[13px]"
              />
            </div>
          </Field>
          {repo && (
            <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm">
              <Check className="h-4 w-4 text-ok" aria-hidden />
              <span className="text-muted">{repo.owner}</span>
              <span className="text-faint">/</span>
              <span className="font-medium">{repo.repo}</span>
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Project name" htmlFor="name" error={show("name")}
              hint={effectiveName && `Served at ${effectiveName}-<you>.localhost`}>
              <Input
                id="name"
                value={effectiveName}
                onChange={(e) => {
                  setNameTouched(true);
                  setName(e.target.value.toLowerCase());
                }}
                placeholder="my-app"
                aria-invalid={Boolean(show("name"))}
                className="font-mono text-[13px]"
              />
            </Field>
            <Field label="Branch" htmlFor="branch" hint="Empty = the repo's default branch">
              <Input id="branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main"
                className="font-mono text-[13px]" />
            </Field>
          </div>

          <Field
            label="Container port"
            htmlFor="port"
            error={show("port")}
            hint={
              detected?.error ? (
                <span className="text-amber-400">{detected.error}</span>
              ) : detected?.port ? (
                detected.fromExpose
                  ? `Detected EXPOSE ${detected.port} in the Dockerfile. Leave empty to use it.`
                  : `No EXPOSE found, defaults to ${detected.port}.`
              ) : (
                "Empty = first EXPOSE in the Dockerfile, else 8000"
              )
            }
          >
            <Input id="port" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
              placeholder={detected?.port ? String(detected.port) : "auto"} aria-invalid={Boolean(show("port"))}
              className="font-mono text-[13px] sm:w-40" />
          </Field>
        </Card>

        <Card className="space-y-3 p-5 sm:p-6">
          <div>
            <h2 className="text-sm font-semibold">Environment variables</h2>
            <p className="mt-0.5 text-[13px] text-muted">Encrypted at rest and injected when the container starts.</p>
          </div>
          <EnvEditor rows={env} onChange={setEnv} />
          {submitted && errors.env && <p className="text-[13px] text-red-400">{errors.env}</p>}
        </Card>

        <Card className="flex items-center justify-between gap-4 p-5 sm:p-6">
          <div>
            <label htmlFor="auto-deploy" className="text-sm font-semibold">Auto-deploy on push</label>
            <p className="mt-0.5 text-[13px] text-muted">Redeploy when GitHub sends a push webhook for this branch.</p>
          </div>
          <Toggle id="auto-deploy" checked={autoDeploy} onChange={setAutoDeploy} label="Auto-deploy on push" />
        </Card>

        {serverError && (
          <p role="alert" className="rounded-md border border-err/30 bg-err/10 px-3 py-2 text-sm text-red-300">
            {serverError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button as={Link} to="/" variant="ghost">Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>
            <Rocket className="h-4 w-4" aria-hidden /> Deploy
          </Button>
        </div>
      </form>
    </div>
  );
}
