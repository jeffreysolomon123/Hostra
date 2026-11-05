// One place that maps backend status words to label + color.
// App status comes from serializers.display_status() in the backend.
export const APP_STATUS = {
  running: { label: "Running", color: "var(--color-ok)" },
  building: { label: "Building", color: "var(--color-info)", pulse: true },
  crashed: { label: "Restarting", color: "var(--color-warn)", pulse: true },
  unhealthy: { label: "Unhealthy", color: "var(--color-warn)" },
  failed: { label: "Failed", color: "var(--color-err)" },
  stopped: { label: "Stopped", color: "var(--color-faint)" },
  missing: { label: "No container", color: "var(--color-faint)" },
};

export const DEPLOY_STATUS = {
  queued: { label: "Queued", color: "var(--color-faint)", pulse: true },
  building: { label: "Building", color: "var(--color-info)", pulse: true },
  live: { label: "Live", color: "var(--color-ok)" },
  failed: { label: "Failed", color: "var(--color-err)" },
};

export const appStatus = (s) => APP_STATUS[s] || { label: s, color: "var(--color-faint)" };
export const deployStatus = (s) => DEPLOY_STATUS[s] || { label: s, color: "var(--color-faint)" };
