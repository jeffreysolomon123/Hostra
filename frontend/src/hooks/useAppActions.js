import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";

/** Redeploy / stop / start / delete with toasts. `after` runs after success (e.g. reload). */
export function useAppActions(after) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null); // "<name>:<action>"

  async function run(name, action, request, message) {
    setBusy(`${name}:${action}`);
    try {
      const res = await request();
      toast.success(message(res));
      after?.();
      return res;
    } catch (err) {
      toast.error(err.message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  return {
    busy,
    redeploy: async (name, { open = false } = {}) => {
      const res = await run(name, "redeploy", () => api(`/apps/${name}/redeploy`, { method: "POST" }),
        (r) => `Deployment #${r.deployment_id} queued for ${name}`);
      if (res && open) navigate(`/projects/${name}/deployments/${res.deployment_id}`);
    },
    stop: (name) => run(name, "stop", () => api(`/apps/${name}/stop`, { method: "POST" }), () => `${name} stopped`),
    start: (name) => run(name, "start", () => api(`/apps/${name}/start`, { method: "POST" }), () => `${name} started`),
    remove: (name) => run(name, "delete", () => api(`/apps/${name}`, { method: "DELETE" }), () => `${name} deleted`),
  };
}
