import { useState } from "react";
import { api } from "./api";

export default function AuthPage({ onLogin }) {
  const [mode, setMode] = useState("login"); // "login" or "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login() {
    // the backend login expects form data, with the email in the "username" field
    const body = new URLSearchParams({ username: email, password });
    const data = await api("/auth/login", { method: "POST", body });
    localStorage.setItem("token", data.access_token);
    onLogin();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "signup") {
        await api("/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
      }
      await login();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.wrap}>
      <form onSubmit={handleSubmit} style={styles.card}>
        <h1 style={{ margin: 0 }}>Hostra</h1>
        <p style={{ color: "#666", marginTop: 4 }}>
          {mode === "login" ? "Log in to your account" : "Create an account"}
        </p>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={styles.input}
        />
        <input
          type="password"
          placeholder="Password (min 8 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          style={styles.input}
        />

        {error && <p style={{ color: "crimson", margin: 0 }}>{error}</p>}

        <button type="submit" disabled={loading} style={styles.button}>
          {loading ? "Please wait..." : mode === "login" ? "Log in" : "Sign up"}
        </button>

        <p style={{ fontSize: 14, margin: 0 }}>
          {mode === "login" ? "No account? " : "Already have one? "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setError("");
              setMode(mode === "login" ? "signup" : "login");
            }}
          >
            {mode === "login" ? "Sign up" : "Log in"}
          </a>
        </p>
      </form>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "sans-serif",
    background: "#f4f5f7",
  },
  card: {
    background: "white",
    padding: 32,
    borderRadius: 12,
    width: 320,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    boxShadow: "0 2px 12px rgba(0,0,0,0.1)",
  },
  input: { padding: 10, fontSize: 15, borderRadius: 6, border: "1px solid #ccc" },
  button: {
    padding: 10,
    fontSize: 15,
    borderRadius: 6,
    border: "none",
    background: "#111",
    color: "white",
    cursor: "pointer",
  },
};