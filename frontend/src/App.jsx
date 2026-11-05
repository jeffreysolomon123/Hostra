import { useEffect, useState } from "react";
import { api } from "./api";
import AuthPage from "./AuthPage";
import Dashboard from "./Dashboard";
import AppDetail from "./AppDetail";
export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [selected, setSelected] = useState(null);

  // on page load, ask the backend who we are (if a token is saved)
  function loadUser() {
    if (!localStorage.getItem("token")) {
      setChecking(false);
      return;
    }
    api("/auth/me")
      .then(setUser)
      .catch(() => localStorage.removeItem("token")) // expired or invalid token
      .finally(() => setChecking(false));
  }

  useEffect(loadUser, []);

  function handleLogin() {
    setChecking(true);
    loadUser();
  }

    function logout() {
    localStorage.removeItem("token");
    setUser(null);
    setSelected(null);
  }

  if (checking) return <p style={{ padding: 40 }}>Loading...</p>;
  if (!user) return <AuthPage onLogin={handleLogin} />;

  return (
    <div style={{ fontFamily: "sans-serif", background: "#f4f5f7", minHeight: "100vh" }}>
      <header
        style={{
          background: "white",
          padding: "12px 40px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        }}
      >
        <strong style={{ fontSize: 20 }}>Hostra</strong>
        <div>
          <span style={{ color: "#666", marginRight: 12 }}>{user.email}</span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>
      <main style={{ maxWidth: 800, margin: "0 auto", padding: 40 }}>
                {selected ? (
          <AppDetail name={selected} onBack={() => setSelected(null)} />
        ) : (
          <Dashboard onOpen={setSelected} />
        )}
      </main>
    </div>
  );
}