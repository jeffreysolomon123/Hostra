import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import MetricsCharts from "./MetricsCharts";
import { useWebSocket } from "./hooks/useWebSocket";

const MAX_LINES = 2000;

const STATUS_COLORS = {
  running: "#16a34a",
  exited: "#dc2626",
  missing: "#6b7280",
};

export default function AppDetail({ name, onBack }) {
  const [app, setApp] = useState(null);
  const [lines, setLines] = useState([]);
  const [error, setError] = useState("");
  const logRef = useRef(null);

  // Live logs over WebSocket. On every (re)connect the server resends the last
  // 200 lines, so start from an empty list to avoid duplicates.
  const live = useWebSocket(
    `/ws/apps/${name}/logs`,
    (msg) => {
      if (msg.type === "logs") setLines((prev) => [...prev, ...msg.lines].slice(-MAX_LINES));
      if (msg.type === "detached") setLines((prev) => [...prev, `--- ${msg.message} ---`]);
    },
    { onOpen: () => setLines([]) }
  );

  function loadApp() {
    api(`/apps/${name}`)
      .then((a) => {
        setApp(a);
        setError("");
      })
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    loadApp();
    const id = setInterval(loadApp, 5000);
    return () => clearInterval(id);
  }, [name]);

  // REST fallback: while the socket is down, poll the logs instead
  useEffect(() => {
    if (live === "live") return undefined;
    function poll() {
      api(`/apps/${name}/logs?tail=200`)
        .then((d) => setLines((d.logs || "").split("\n")))
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [name, live]);

  // keep the log box scrolled to the newest line
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

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
      <h3>
        Logs{" "}
        <span style={{ fontSize: 13, fontWeight: 400, color: live === "live" ? "#16a34a" : "#d97706" }}>
          ● {live === "live" ? "Live" : "Reconnecting…"}
        </span>
      </h3>
      <pre ref={logRef} style={styles.logs}>
        {lines.length ? lines.join("\n") : "(no output yet)"}
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