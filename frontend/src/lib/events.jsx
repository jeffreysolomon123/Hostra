import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { useWebSocket } from "../hooks/useWebSocket";

// ONE /ws/events connection for the whole logged-in app. Pages subscribe to it
// instead of opening their own sockets.
const EventsContext = createContext({ status: "closed", subscribe: () => () => {} });

export function EventsProvider({ children }) {
  const listeners = useRef(new Set());
  const status = useWebSocket("/ws/events", (msg) => {
    listeners.current.forEach((fn) => fn(msg));
  });
  // stable identity, so subscribers do not resubscribe on every status change
  const subscribe = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);
  return <EventsContext.Provider value={{ status, subscribe }}>{children}</EventsContext.Provider>;
}

export const useEventsStatus = () => useContext(EventsContext).status;

/**
 * Call `reload` when a live event arrives (optionally only for one app).
 * Events come in bursts (queued -> building -> live), so reloads are coalesced
 * into one call 300ms after the last event.
 */
export function useLiveReload(reload, appName) {
  const { subscribe } = useContext(EventsContext);
  const latest = useRef(reload);
  useEffect(() => {
    latest.current = reload;
  });
  useEffect(() => {
    let timer = null;
    const unsubscribe = subscribe((msg) => {
      if (msg.type === "hello") return;
      if (appName && msg.app !== appName) return;
      clearTimeout(timer);
      timer = setTimeout(() => latest.current(), 300);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [subscribe, appName]);
}
