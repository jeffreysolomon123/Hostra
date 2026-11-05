import { useEffect, useState } from "react";
import { api } from "./api";
import AuthPage from "./AuthPage";

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

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
  }

  if (checking) return <p style={{ padding: 40 }}>Loading...</p>;
  if (!user) return <AuthPage onLogin={handleLogin} />;

  return (
    <div style={{ padding: 40, fontFamily: "sans-serif" }}>
      <h1>Hostra</h1>
      <p>Logged in as {user.email}</p>
      <button onClick={logout}>Log out</button>
    </div>
  );
}