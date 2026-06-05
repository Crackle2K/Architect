import type { ServerStatus } from "../types";

const CONFIG: Record<ServerStatus, { label: string; color: string; dot: string }> = {
  running: { label: "Running", color: "#16a34a", dot: "#22c55e" },
  starting: { label: "Starting", color: "#ca8a04", dot: "#eab308" },
  stopping: { label: "Stopping", color: "#dc2626", dot: "#ef4444" },
  stopped: { label: "Stopped", color: "#4b5563", dot: "#6b7280" },
};

export default function StatusBadge({ status }: { status: ServerStatus }) {
  const { label, color, dot } = CONFIG[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        borderRadius: 99,
        fontSize: 12,
        fontWeight: 600,
        backgroundColor: color + "22",
        color,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: dot,
          ...(status === "starting" || status === "stopping"
            ? { animation: "pulse 1.5s infinite" }
            : {}),
        }}
      />
      {label}
    </span>
  );
}
