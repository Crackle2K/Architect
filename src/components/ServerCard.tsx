import { Play, Square, Trash2, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ServerInfo } from "../types";
import { startServer, stopServer } from "../lib/tauri";
import StatusBadge from "./StatusBadge";
import ServerTypeIcon from "./ServerTypeIcon";

interface Props {
  server: ServerInfo;
  onRefresh: () => void;
  onDelete: (id: string) => void;
}

export default function ServerCard({ server, onRefresh, onDelete }: Props) {
  const navigate = useNavigate();
  const isRunning = server.status === "running" || server.status === "starting";

  async function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      if (isRunning) {
        await stopServer(server.id);
      } else {
        await startServer(server.id);
      }
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    onDelete(server.id);
  }

  return (
    <div
      onClick={() => navigate(`/server/${server.id}`)}
      style={{
        backgroundColor: "var(--color-surface-1)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: 20,
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor =
          "var(--color-border-hover)";
        (e.currentTarget as HTMLDivElement).style.boxShadow =
          "0 4px 16px rgba(0,0,0,0.25)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor =
          "var(--color-border)";
        (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            backgroundColor: "var(--color-surface-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <ServerTypeIcon type={server.server_type} size={28} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--color-text-primary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {server.name}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              marginTop: 3,
              textTransform: "capitalize",
            }}
          >
            {server.server_type} {server.minecraft_version}
          </div>
        </div>

        <StatusBadge status={server.status} />
      </div>

      {/* Stats row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          fontSize: 13,
          color: "var(--color-text-secondary)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Users size={13} />
          {server.players_online}/{server.players_max}
        </span>
        <span>:{server.port}</span>
        <span>{server.max_ram_mb} MB RAM</span>
      </div>

      {/* Actions */}
      <div
        style={{ display: "flex", gap: 8 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleToggle}
          disabled={
            server.status === "starting" || server.status === "stopping"
          }
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "8px 14px",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            transition: "background 0.15s",
            backgroundColor: isRunning
              ? "var(--color-surface-3)"
              : "var(--color-orange-primary)",
            color: isRunning
              ? "var(--color-text-secondary)"
              : "#fff",
            opacity:
              server.status === "starting" || server.status === "stopping"
                ? 0.5
                : 1,
          }}
        >
          {isRunning ? <Square size={13} /> : <Play size={13} />}
          {isRunning ? "Stop" : "Start"}
        </button>

        <button
          onClick={handleDelete}
          style={{
            padding: "8px 10px",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            background: "transparent",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            display: "flex",
            alignItems: "center",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = "#ef4444";
            (e.currentTarget as HTMLButtonElement).style.color = "#ef4444";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "var(--color-border)";
            (e.currentTarget as HTMLButtonElement).style.color =
              "var(--color-text-muted)";
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
