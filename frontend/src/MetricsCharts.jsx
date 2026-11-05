import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "./api";

function Chart({ title, unit, data, lines }) {
  return (
    <div style={styles.card}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        {title} <span style={{ color: "#888", fontWeight: 400 }}>({unit})</span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="time" tick={{ fontSize: 11 }} minTickGap={40} />
          <YAxis tick={{ fontSize: 11 }} width={45} />
          <Tooltip />
          {lines.map((l) => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              name={l.name}
              stroke={l.color}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function MetricsCharts({ name }) {
  const [data, setData] = useState([]);

  function load() {
    api(`/apps/${name}/metrics?minutes=15`)
      .then((points) =>
        setData(
          points.map((p) => ({
            ...p,
            time: new Date(p.t * 1000).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
          }))
        )
      )
      .catch(() => {});
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [name]);

  if (data.length === 0) {
    return (
      <p style={{ color: "#666" }}>
        No readings yet. The collector records one every 5 seconds while the app is running.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Chart
        title="CPU"
        unit="%"
        data={data}
        lines={[{ key: "cpu_percent", name: "CPU %", color: "#2563eb" }]}
      />
      <Chart
        title="Memory"
        unit="MB"
        data={data}
        lines={[{ key: "mem_mb", name: "Memory MB", color: "#16a34a" }]}
      />
      <Chart
        title="Network"
        unit="KB/s"
        data={data}
        lines={[
          { key: "rx_kbps", name: "Received", color: "#d97706" },
          { key: "tx_kbps", name: "Sent", color: "#9333ea" },
        ]}
      />
    </div>
  );
}

const styles = {
  card: {
    background: "white",
    padding: 16,
    borderRadius: 10,
    boxShadow: "0 1px 6px rgba(0,0,0,0.1)",
  },
};