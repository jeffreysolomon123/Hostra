// Base URL of the Hostra API, set in frontend/.env as VITE_API_URL.
export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
// Same host, ws:// instead of http:// (wss:// for https)
export const WS_BASE = API_BASE.replace(/^http/, "ws");

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function getToken() {
  return localStorage.getItem("token");
}

export function setToken(token) {
  if (token) localStorage.setItem("token", token);
  else localStorage.removeItem("token");
}

// Any 401 anywhere means the session is gone: the app listens for this event,
// logs out and shows a toast. One place instead of a check in every component.
export const UNAUTHORIZED_EVENT = "hostra:unauthorized";

export async function api(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    options = { ...options, body: JSON.stringify(options.json) };
  }

  const res = await fetch(API_BASE + path, { ...options, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      // FastAPI validation errors are a list of {loc, msg}
      detail = Array.isArray(body.detail)
        ? body.detail.map((d) => d.msg.replace(/^Value error, /, "")).join(", ")
        : body.detail || detail;
    } catch {
      /* not JSON */
    }
    if (res.status === 401 && token && path !== "/auth/login") {
      setToken(null);
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(detail, res.status);
  }
  return res.status === 204 ? null : res.json();
}
