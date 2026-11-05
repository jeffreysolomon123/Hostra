import { useEffect, useRef, useState } from "react";
import { api, WS_BASE } from "../lib/api";

const MAX_DELAY_MS = 30_000;

/**
 * Authenticated WebSocket with automatic reconnect.
 *
 *   const status = useWebSocket("/ws/events", (msg) => ..., { onOpen })
 *   status: "connecting" | "live" | "reconnecting" | "closed"
 *
 * - Browsers cannot set an Authorization header on a WebSocket, so every
 *   (re)connect first fetches a fresh single-use ticket with the normal token.
 * - On an unexpected close it retries with exponential backoff + jitter
 *   (~0.5s, 1s, 2s, 4s ... max 30s) so a restarting server is not stampeded.
 * - Close 1000 (finished, e.g. a build) and 4404 (not yours) are final: no retry.
 * - Server "ping" heartbeats are swallowed here.
 */
export function useWebSocket(path, onMessage, { enabled = true, onOpen } = {}) {
  const [status, setStatus] = useState("connecting");
  // Keep the latest callbacks in refs, so passing a new arrow function on every
  // render does not tear down and reopen the socket.
  const handlers = useRef({ onMessage, onOpen });
  useEffect(() => {
    handlers.current = { onMessage, onOpen };
  });

  useEffect(() => {
    if (!enabled || !path) return undefined;
    let ws = null;
    let timer = null;
    let attempt = 0;
    let stopped = false;

    function retryLater() {
      if (stopped) return;
      setStatus("reconnecting");
      const delay = Math.min(MAX_DELAY_MS, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
      attempt += 1;
      timer = setTimeout(connect, delay);
    }

    async function connect() {
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      let ticket;
      try {
        ({ ticket } = await api("/auth/ws-ticket", { method: "POST" }));
      } catch {
        retryLater();
        return;
      }
      if (stopped) return;
      const sep = path.includes("?") ? "&" : "?";
      ws = new WebSocket(`${WS_BASE}${path}${sep}ticket=${encodeURIComponent(ticket)}`);
      ws.onopen = () => {
        attempt = 0;
        setStatus("live");
        handlers.current.onOpen?.();
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type !== "ping") handlers.current.onMessage?.(msg);
      };
      ws.onclose = (e) => {
        if (stopped) return;
        if (e.code === 1000 || e.code === 4404) setStatus("closed");
        else retryLater(); // includes 4401: the next attempt fetches a new ticket anyway
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [path, enabled]);

  return status;
}
