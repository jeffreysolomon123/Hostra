// Small pure helpers used across pages.

export const cn = (...classes) => classes.filter(Boolean).join(" ");

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const ago = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return ago(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return ago(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 30) return ago(days, "day");
  const months = Math.floor(days / 30);
  if (months < 12) return ago(months, "month");
  return ago(Math.floor(months / 12), "year");
}

export function formatDuration(seconds) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function formatMb(mb) {
  if (mb == null) return "—";
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

export const shortSha = (sha) => (sha ? sha.slice(0, 7) : "—");

// Mirrors backend/app/validation.py so the user gets instant feedback.
const REPO_RE = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;
export function parseRepo(url) {
  const m = REPO_RE.exec((url || "").trim());
  if (!m || m[2] === "." || m[2] === "..") return null;
  return { owner: m[1], repo: m[2] };
}

export const APP_NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,30}$/;

export function slugify(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 31)
    .replace(/-$/, "");
}

// Parse a pasted .env block: KEY=value, `export KEY=value`, # comments, "quoted values".
export function parseDotEnv(text) {
  const vars = {};
  const errors = [];
  (text || "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) {
      errors.push(`Line ${i + 1}: expected KEY=value`);
      return;
    }
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, ""); // strip trailing comment on unquoted values
    vars[m[1]] = value;
  });
  return { vars, errors };
}
