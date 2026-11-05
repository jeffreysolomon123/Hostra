import { ChartLine, Table2 } from "lucide-react";
import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button, Card, EmptyState, Segmented, Skeleton } from "../../components/ui";
import { useApi } from "../../hooks/useApi";

// Series colors were checked with the dataviz palette validator for the dark
// surface (CVD separation + 3:1 contrast). Text never uses series colors.
const S1 = "var(--color-series-1)";
const S2 = "var(--color-series-2)";
const AXIS = { fill: "#707070", fontSize: 11 };
const time = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 text-muted">{new Date(label * 1000).toLocaleTimeString()}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-fg">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
          <span className="text-muted">{p.name}</span>
          <span className="ml-auto font-medium tabular-nums">
            {p.value == null ? "—" : `${p.value} ${unit}`}
          </span>
        </p>
      ))}
    </div>
  );
}

function ChartCard({ title, unit, children, legend }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {title} <span className="font-normal text-faint">({unit})</span>
        </h3>
        {legend && (
          <ul className="flex gap-3 text-xs text-muted">
            {legend.map((l) => (
              <li key={l.name} className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 rounded" style={{ background: l.color }} aria-hidden />
                {l.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

const axes = (unit) => [
  <CartesianGrid key="g" vertical={false} stroke="#262626" />,
  <XAxis key="x" dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={time}
    tick={AXIS} axisLine={false} tickLine={false} minTickGap={48} />,
  <YAxis key="y" tick={AXIS} axisLine={false} tickLine={false} width={44} />,
  <Tooltip key="tt" content={<ChartTooltip unit={unit} />} cursor={{ stroke: "#3a3a3a" }} />,
];

// (No limit line on the memory chart: at ~20 MB of 512 MB it would squash the real
// data flat. The Memory stat tile shows "% of limit" instead.)
function AreaSeries({ data, dataKey, name, unit }) {
  const gid = `grad-${dataKey}`;
  return (
    <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={S1} stopOpacity={0.3} />
          <stop offset="100%" stopColor={S1} stopOpacity={0} />
        </linearGradient>
      </defs>
      {axes(unit)}
      <Area type="monotone" dataKey={dataKey} name={name} stroke={S1} strokeWidth={2} fill={`url(#${gid})`}
        dot={false} activeDot={{ r: 4, stroke: "#111111", strokeWidth: 2 }} isAnimationActive={false} />
    </AreaChart>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-faint">{sub}</p>}
    </div>
  );
}

export default function Metrics() {
  const { app } = useOutletContext();
  const [range, setRange] = useState(15);
  const [table, setTable] = useState(false);
  // charts poll every 5s (the collector's interval); no WebSocket needed here
  const metrics = useApi(`/apps/${app.name}/metrics?minutes=${range}`, { interval: 5000 });
  const data = metrics.data || [];
  const last = data[data.length - 1];
  const memLimit = parseInt(app.limits.memory, 10);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Time range" value={range} onChange={setRange}
          options={[{ value: 15, label: "15 min" }, { value: 60, label: "1 hour" }]} />
        <Button size="sm" variant="ghost" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? <ChartLine className="h-3.5 w-3.5" aria-hidden /> : <Table2 className="h-3.5 w-3.5" aria-hidden />}
          {table ? "Show charts" : "Show table"}
        </Button>
      </div>

      {metrics.loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-60" />)}
        </div>
      ) : data.length === 0 ? (
        <EmptyState icon={ChartLine} title="No readings yet"
          description="The collector records CPU, memory and network every 5 seconds while the app is running." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4">
            <Stat label="CPU" value={`${last.cpu_percent.toFixed(1)}%`} sub={`of ${app.limits.cpus} vCPU limit`} />
            <Stat label="Memory" value={`${last.mem_mb.toFixed(1)} MB`}
              sub={`${Math.round((last.mem_mb / memLimit) * 100)}% of ${memLimit} MB`} />
            <Stat label="Network" value={`${last.rx_kbps.toFixed(1)} KB/s`} sub={`in · ${last.tx_kbps.toFixed(1)} KB/s out`} />
            <Stat label="Disk (writable layer)" value={last.disk_mb == null ? "—" : `${last.disk_mb.toFixed(1)} MB`}
              sub="sampled every 60s" />
          </div>

          {table ? (
            <Card className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <caption className="sr-only">Metric readings</caption>
                <thead className="text-left text-xs text-muted">
                  <tr className="border-b border-line">
                    {["Time", "CPU %", "Memory MB", "In KB/s", "Out KB/s", "Disk MB"].map((h) => (
                      <th key={h} scope="col" className="px-4 py-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...data].reverse().slice(0, 60).map((p) => (
                    <tr key={p.t}>
                      <td className="px-4 py-2 text-muted">{new Date(p.t * 1000).toLocaleTimeString()}</td>
                      <td className="px-4 py-2">{p.cpu_percent}</td>
                      <td className="px-4 py-2">{p.mem_mb}</td>
                      <td className="px-4 py-2">{p.rx_kbps}</td>
                      <td className="px-4 py-2">{p.tx_kbps}</td>
                      <td className="px-4 py-2">{p.disk_mb ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <ChartCard title="CPU" unit="%">
                <AreaSeries data={data} dataKey="cpu_percent" name="CPU" unit="%" />
              </ChartCard>
              <ChartCard title="Memory" unit="MB">
                <AreaSeries data={data} dataKey="mem_mb" name="Memory" unit="MB" />
              </ChartCard>
              <ChartCard title="Network" unit="KB/s" legend={[{ name: "In", color: S1 }, { name: "Out", color: S2 }]}>
                <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  {axes("KB/s")}
                  <Line type="monotone" dataKey="rx_kbps" name="In" stroke={S1} strokeWidth={2} dot={false}
                    activeDot={{ r: 4, stroke: "#111111", strokeWidth: 2 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="tx_kbps" name="Out" stroke={S2} strokeWidth={2} dot={false}
                    activeDot={{ r: 4, stroke: "#111111", strokeWidth: 2 }} isAnimationActive={false} />
                </LineChart>
              </ChartCard>
              <ChartCard title="Disk" unit="MB">
                <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  {axes("MB")}
                  <Line type="stepAfter" dataKey="disk_mb" name="Disk" stroke={S1} strokeWidth={2} dot={false}
                    connectNulls activeDot={{ r: 4, stroke: "#111111", strokeWidth: 2 }} isAnimationActive={false} />
                </LineChart>
              </ChartCard>
            </div>
          )}
        </>
      )}
    </div>
  );
}
