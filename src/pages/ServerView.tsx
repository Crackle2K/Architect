import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  FolderOpen,
  Play,
  RefreshCw,
  Square,
  Terminal,
  Users,
} from "lucide-react";
import type { LogEvent, PlayerInfo, ServerInfo, StatusEvent } from "../types";
import FileManager from "../components/FileManager";
import ServerTypeIcon from "../components/ServerTypeIcon";
import {
  listServers,
  queryPlayers,
  restartServer,
  sendCommand,
  startServer,
  stopServer,
} from "../lib/tauri";
import StatusBadge from "../components/StatusBadge";

type Tab = "console" | "players" | "files";

const LOG_COLORS: Record<string, string> = {
  ERROR: "#ef4444",
  WARN: "#eab308",
  INFO: "var(--color-text-secondary)",
};

export default function ServerView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [server, setServer] = useState<ServerInfo | null>(null);
  const [tab, setTab] = useState<Tab>("console");
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [command, setCommand] = useState("");
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  async function refresh() {
    if (!id) return;
    const all = await listServers();
    const found = all.find((s) => s.id === id) ?? null;
    setServer(found);
  }

  useEffect(() => {
    refresh();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const unlistenLog = listen<LogEvent>("server-log", (e) => {
      if (e.payload.server_id !== id) return;
      setLogs((prev) => [...prev.slice(-2000), e.payload]);
    });
    const unlistenStatus = listen<StatusEvent>("server-status", (e) => {
      if (e.payload.server_id !== id) return;
      setServer((prev) =>
        prev
          ? {
              ...prev,
              status: e.payload.status,
              players_online: e.payload.players_online,
              players_max: e.payload.players_max,
            }
          : prev
      );
    });
    return () => {
      unlistenLog.then((fn) => fn());
      unlistenStatus.then((fn) => fn());
    };
  }, [id]);

  useEffect(() => {
    if (autoScroll) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  async function fetchPlayers() {
    if (!id) return;
    setLoadingPlayers(true);
    try {
      const result = await queryPlayers(id);
      setPlayers(result.sample);
    } catch {
      setPlayers([]);
    } finally {
      setLoadingPlayers(false);
    }
  }

  useEffect(() => {
    if (tab !== "players") return;
    fetchPlayers();
    const interval = setInterval(fetchPlayers, 10000);
    return () => clearInterval(interval);
  }, [tab, id]);

  async function handleToggle() {
    if (!id || !server) return;
    if (server.status === "running" || server.status === "starting") {
      await stopServer(id);
    } else {
      await startServer(id);
    }
    refresh();
  }

  async function handleRestart() {
    if (!id) return;
    await restartServer(id);
    refresh();
  }

  async function handleSendCommand(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !command.trim()) return;
    await sendCommand(id, command.trim());
    setCommand("");
  }

  if (!server) {
    return (
      <div style={{ padding: 28 }}>
        <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>
      </div>
    );
  }

  const isRunning = server.status === "running" || server.status === "starting";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Top bar */}
      <div
        style={{
          padding: "16px 28px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => navigate("/")}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-muted)",
            display: "flex",
            padding: 4,
            borderRadius: 6,
          }}
        >
          <ArrowLeft size={18} />
        </button>

        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            backgroundColor: "var(--color-surface-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
          }}
        >
          <ServerTypeIcon type={server.server_type} size={28} />
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{server.name}</div>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)", textTransform: "capitalize" }}>
            {server.server_type} {server.minecraft_version} · :{server.port}
          </div>
        </div>

        <StatusBadge status={server.status} />

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleToggle}
            disabled={server.status === "starting" || server.status === "stopping"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              border: "none",
              borderRadius: 8,
              background: isRunning ? "var(--color-surface-3)" : "var(--color-orange-primary)",
              color: isRunning ? "var(--color-text-secondary)" : "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              opacity: server.status === "starting" || server.status === "stopping" ? 0.5 : 1,
            }}
          >
            {isRunning ? <Square size={13} /> : <Play size={13} />}
            {isRunning ? "Stop" : "Start"}
          </button>

          {isRunning && (
            <button
              onClick={handleRestart}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                background: "transparent",
                color: "var(--color-text-secondary)",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <RefreshCw size={13} />
              Restart
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 2,
          padding: "0 28px",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
        }}
      >
        {(["console", "players", "files"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "12px 16px",
              border: "none",
              borderBottom: tab === t ? "2px solid var(--color-orange-primary)" : "2px solid transparent",
              background: "transparent",
              color: tab === t ? "var(--color-orange-primary)" : "var(--color-text-muted)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              textTransform: "capitalize",
              marginBottom: -1,
            }}
          >
            {t === "console" ? (
              <Terminal size={14} />
            ) : t === "players" ? (
              <Users size={14} />
            ) : (
              <FolderOpen size={14} />
            )}
            {t}
            {t === "players" && (
              <span
                style={{
                  padding: "1px 6px",
                  borderRadius: 99,
                  fontSize: 11,
                  backgroundColor: "var(--color-surface-3)",
                  color: "var(--color-text-muted)",
                }}
              >
                {server.players_online}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {tab === "files" ? (
          <FileManager serverId={id!} />
        ) : tab === "console" ? (
          <>
            {/* Log area */}
            <div
              onScroll={(e) => {
                const el = e.currentTarget;
                const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                setAutoScroll(atBottom);
              }}
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "16px 28px",
                fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
                fontSize: 12,
                lineHeight: 1.7,
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              {logs.length === 0 ? (
                <span style={{ color: "var(--color-text-muted)" }}>
                  {isRunning ? "Waiting for output…" : "Start the server to see logs."}
                </span>
              ) : (
                logs.map((log, i) => (
                  <div
                    key={i}
                    style={{ color: LOG_COLORS[log.level] ?? "var(--color-text-secondary)" }}
                  >
                    {log.line}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>

            {/* Command input */}
            <form
              onSubmit={handleSendCommand}
              style={{
                display: "flex",
                gap: 8,
                padding: "12px 28px",
                borderTop: "1px solid var(--color-border)",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  padding: "10px 0",
                  color: "var(--color-orange-primary)",
                  fontFamily: "monospace",
                  fontSize: 14,
                  userSelect: "none",
                }}
              >
                /
              </span>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                disabled={!isRunning}
                placeholder={isRunning ? "Enter command…" : "Server is not running"}
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  background: "var(--color-surface-2)",
                  color: "var(--color-text-primary)",
                  fontSize: 13,
                  fontFamily: "monospace",
                  outline: "none",
                  opacity: isRunning ? 1 : 0.5,
                }}
              />
              <button
                type="submit"
                disabled={!isRunning || !command.trim()}
                style={{
                  padding: "9px 16px",
                  border: "none",
                  borderRadius: 8,
                  background: "var(--color-orange-primary)",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  opacity: !isRunning || !command.trim() ? 0.4 : 1,
                }}
              >
                Send
              </button>
            </form>
          </>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                {server.players_online} / {server.players_max} players online
              </span>
              <button
                onClick={fetchPlayers}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 12px",
                  border: "1px solid var(--color-border)",
                  borderRadius: 7,
                  background: "transparent",
                  color: "var(--color-text-secondary)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <RefreshCw size={12} />
                Refresh
              </button>
            </div>

            {loadingPlayers ? (
              <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Querying server…</p>
            ) : players.length === 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: "40px 0",
                  gap: 10,
                  color: "var(--color-text-muted)",
                }}
              >
                <Users size={36} strokeWidth={1} />
                <p style={{ margin: 0, fontSize: 14 }}>No players online</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {players.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 14px",
                      borderRadius: 8,
                      backgroundColor: "var(--color-surface-1)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    <img
                      src={`https://mc-heads.net/avatar/${p.name}/32`}
                      alt={p.name}
                      width={28}
                      height={28}
                      style={{ borderRadius: 4, imageRendering: "pixelated" }}
                    />
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{p.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
