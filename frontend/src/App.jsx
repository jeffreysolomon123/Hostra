import { useEffect, useState } from "react";
import { api } from "./api";

export default function App() {
  const [status, setStatus] = useState("checking...");

  useEffect(() => {
    api("/health")
      .then((d) => setStatus(d.status))
      .catch(() => setStatus("backend unreachable"));
  }, []);

  return (
    <div style={{ padding: 40, fontFamily: "sans-serif" }}>
      <h1>Hostra</h1>
      <p>Backend: {status}</p>
    </div>
  );
}