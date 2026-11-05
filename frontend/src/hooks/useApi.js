import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

/**
 * GET `path` on mount (and every `interval` ms if given).
 * Returns { data, error, loading, reload, setData }.
 * A response for an old path (user navigated away) is ignored.
 */
export function useApi(path, { interval } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true, path });
  const current = useRef(path);
  useEffect(() => {
    current.current = path;
  }, [path]);

  const reload = useCallback(() => {
    if (!path) return Promise.resolve();
    return api(path)
      .then((data) => {
        if (current.current === path) setState({ data, error: null, loading: false, path });
      })
      .catch((error) => {
        if (current.current === path) setState((s) => ({ ...s, error, loading: false }));
      });
  }, [path]);

  useEffect(() => {
    reload();
    if (!interval) return undefined;
    const id = setInterval(reload, interval);
    return () => clearInterval(id);
  }, [reload, interval]);

  const setData = useCallback((fn) => {
    setState((s) => ({ ...s, data: typeof fn === "function" ? fn(s.data) : fn }));
  }, []);

  // While a new path loads, do not show the previous path's data
  const stale = state.path !== path;
  return {
    data: stale ? null : state.data,
    error: stale ? null : state.error,
    loading: stale || state.loading,
    reload,
    setData,
  };
}
