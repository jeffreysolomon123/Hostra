import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import MetricsCharts from "./MetricsCharts";

const STATUS_COLORS = {
  running: "#16a34a",
  exited: "#dc2626",
  missing: "#6b7280",
};

export default function AppDetail({ name, onBack }) {
  const [app, setApp] = useState(null);
  const [logs, setLogs] = useState("");
  const [error, setError] = useState("");
  const logRef = useRef(null);

  function load() {
    api("/apps")
      .then((list) => setApp(list.find((a) => a.name === name) || null))
      .catch((err) => setError(err.message));

    api(`/apps/${name}/logs?tail=200`)
      .then((d) => {
        setLogs(d.logs || "(no output yet)");
        setError("");
      })
      .catch((err) => setLogs(`Could not load logs: ${err.message}`));
  }

  // load now, then refresh every 3 seconds
  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [name]);

  // keep the log box scrolled to the newest line
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div>
      <button onClick={onBack} style={styles.back}>
        ← Back to apps
      </button>

      <h2 style={{ marginBottom: 4 }}>
        {name}{" "}
        {app && (
          <span
            style={{
              ...styles.badge,
              background: STATUS_COLORS[app.status] || "#d97706",
            }}
          >
            {app.status}
          </span>
        )}
      </h2>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {app && (
        <div style={{ color: "#666", fontSize: 14, lineHeight: 1.6 }}>
          <div>Repo: {app.repo_url}</div>
          <div>Container port: {app.port}</div>
          <div>
            URL:{" "}
            <a href={app.url} target="_blank" rel="noreferrer">
              {app.url}
            </a>
          </div>
        </div>
      )}
        <h3>Usage</h3>
      <MetricsCharts name={name} />
      <h3>Logs</h3>
      <pre ref={logRef} style={styles.logs}>
        {logs}
      </pre>
    </div>
  );
}

const styles = {
  back: {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid #ccc",
    background: "white",
    cursor: "pointer",
    marginBottom: 16,
  },
  badge: {
    color: "white",
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 10,
    verticalAlign: "middle",
  },
  logs: {
    background: "#111",
    color: "#d4d4d4",
    padding: 16,
    borderRadius: 8,
    height: 360,
    overflow: "auto",
    fontSize: 13,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
};