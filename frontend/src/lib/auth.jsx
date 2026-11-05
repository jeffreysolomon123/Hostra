import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, getToken, setToken, UNAUTHORIZED_EVENT } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // only "loading" if there is a saved token to check
  const [loading, setLoading] = useState(() => Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) return;
    api("/auth/me")
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  // lib/api.js fires this on any 401: the session is gone
  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      toast.error("Your session expired. Please log in again.");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (email, password) => {
    // OAuth2 password flow: form-encoded, the email goes in "username"
    const body = new URLSearchParams({ username: email, password });
    const { access_token } = await api("/auth/login", { method: "POST", body });
    setToken(access_token);
    setUser(await api("/auth/me"));
  }, []);

  const signup = useCallback(
    async (email, password) => {
      await api("/auth/signup", { method: "POST", json: { email, password } });
      await login(email, password);
    },
    [login]
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
