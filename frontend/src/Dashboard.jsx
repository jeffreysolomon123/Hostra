import { useEffect, useState } from "react";
import { api } from "./api";

const STATUS_COLORS = {
  running: "#16a34a",
  exited: "#dc2626",
  missing: "#6b7280",
};

export default function Dashboard({ onOpen }) {
  const [apps, setApps] = useState([]);
  const [error, setError] = useState("");

  // deploy form
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [port, setPort] = useState("5000");
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState("");

  function loadApps() {
    api("/apps")
      .then((data) => {
        setApps(data);
        setError("");
      })
      .catch((err) => setError(err.message));
  }

  // load now, then refresh every 5 seconds
  useEffect(() => {
    loadApps();
    const id = setInterval(loadApps, 5000);
    return () => clearInterval(id);
  }, []);

  async function handleDeploy(e) {
    e.preventDefault();
    setDeployError("");
    setDeploying(true);
    try {
      await api("/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          repo_url: repoUrl,
          port: Number(port),
        }),
      });
      setName("");
      setRepoUrl("");
      loadApps();
    } catch (err) {
      setDeployError(err.message);
    } finally {
      setDeploying(false);
    }
  }

  async function action(appName, method, path = "") {
    try {
      await api(`/apps/${appName}${path}`, { method });
      loadApps();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h2>New project</h2>
      <form onSubmit={handleDeploy} style={styles.form}>
        <input
          placeholder="App name (e.g. hello)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          pattern="[a-z0-9][a-z0-9\-]{1,30}"
          title="2-31 characters: lowercase letters, digits, hyphens"
          required
          style={styles.input}
        />
        <input
          placeholder="https://github.com/user/repo"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          required
          style={{ ...styles.input, flex: 2 }}
        />
        <input
          type="number"
          placeholder="Port"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          required
          style={{ ...styles.input, width: 80, flex: "none" }}
        />
        <button type="submit" disabled={deploying} style={styles.primary}>
          {deploying ? "Deploying..." : "Deploy"}
        </button>
      </form>
      {deploying && (
        <p style={{ color: "#666" }}>
          Building the image. The first build can take a minute or two...
        </p>
      )}
      {deployError && <p style={{ color: "crimson" }}>{deployError}</p>}

      <h2>Your apps</h2>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {apps.length === 0 && <p style={{ color: "#666" }}>No apps yet. Deploy one above.</p>}

      <div style={{ display: "grid", gap: 12 }}>
        {apps.map((a) => (
          <div key={a.name} style={styles.card}>
            <div style={{ flex: 1 }}>
                <strong
                onClick={() => onOpen(a.name)}
                style={{ fontSize: 18, cursor: "pointer", textDecoration: "underline" }}
                title="Open project page"
              >
                {a.name}
              </strong>{" "}
              <span
                style={{
                  ...styles.badge,
                  background: STATUS_COLORS[a.status] || "#d97706",
                }}
              >
                {a.status}
              </span>
              <div style={{ color: "#666", fontSize: 14, marginTop: 4 }}>
                {a.repo_url}
              </div>
              <a href={a.url} target="_blank" rel="noreferrer" style={{ fontSize: 14 }}>
                {a.url}
              </a>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {a.status === "running" ? (
                <button onClick={() => action(a.name, "POST", "/stop")} style={styles.btn}>
                  Stop
                </button>
              ) : (
                <button onClick={() => action(a.name, "POST", "/start")} style={styles.btn}>
                  Start
                </button>
              )}
              <button
                onClick={() => {
                  if (confirm(`Delete ${a.name}? This removes the container and image.`)) {
                    action(a.name, "DELETE");
                  }
                }}
                style={{ ...styles.btn, color: "crimson" }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  form: { display: "flex", gap: 8, flexWrap: "wrap" },
  input: {
    padding: 10,
    fontSize: 15,
    borderRadius: 6,
    border: "1px solid #ccc",
    flex: 1,
    minWidth: 140,
  },
  primary: {
    padding: "10px 18px",
    fontSize: 15,
    borderRadius: 6,
    border: "none",
    background: "#111",
    color: "white",
    cursor: "pointer",
  },
  card: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    background: "white",
    padding: 16,
    borderRadius: 10,
    boxShadow: "0 1px 6px rgba(0,0,0,0.1)",
  },
  badge: {
    color: "white",
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 10,
    verticalAlign: "middle",
  },
  btn: {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid #ccc",
    background: "white",
    cursor: "pointer",
  },
};