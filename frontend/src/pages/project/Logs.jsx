import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { LogViewer } from "../../components/LogViewer";
import { useWebSocket } from "../../hooks/useWebSocket";
import { api } from "../../lib/api";

const MAX_LINES = 5000; // keep the browser fast on chatty apps

export default function Logs() {
  const { app } = useOutletContext();
  const [lines, setLines] = useState([]);

  // On every (re)connect the server resends the last 200 lines, so start empty.
  const status = useWebSocket(
    `/ws/apps/${app.name}/logs`,
    (msg) => {
      if (msg.type === "logs") setLines((prev) => [...prev, ...msg.lines].slice(-MAX_LINES));
      if (msg.type === "detached") setLines((prev) => [...prev, `--- ${msg.message} ---`]);
    },
    { onOpen: () => setLines([]) }
  );

  // REST fallback while the socket is down
  useEffect(() => {
    if (status === "live") return undefined;
    const poll = () =>
      api(`/apps/${app.name}/logs?tail=500`)
        .then((d) => setLines((d.logs || "").replace(/\n$/, "").split("\n")))
        .catch(() => {});
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [app.name, status]);

  return (
    <LogViewer
      lines={lines}
      status={status}
      filename={`${app.name}.log`}
      emptyText={app.status === "missing" ? "No container yet. Deploy the app first." : "No output yet."}
    />
  );
}
