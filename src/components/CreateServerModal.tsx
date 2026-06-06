import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { X, ChevronRight, ChevronLeft, Loader } from "lucide-react";
import type { AppSettings, CreateServerRequest, DownloadProgress, McVersion, ServerType } from "../types";
import { createServer, getMcVersions, getSettings } from "../lib/tauri";
import ServerTypeIcon from "./ServerTypeIcon";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

const SERVER_TYPES: { id: ServerType; label: string; desc: string }[] = [
  { id: "vanilla", label: "Vanilla", desc: "Official Mojang server. No mods." },
  { id: "paper", label: "Paper", desc: "High-performance fork. Great for plugins." },
  { id: "fabric", label: "Fabric", desc: "Lightweight mod loader." },
  { id: "quilt", label: "Quilt", desc: "Modern Fabric-compatible loader." },
  { id: "forge", label: "Forge", desc: "The classic mod loader. Huge ecosystem." },
  { id: "neoforge", label: "NeoForge", desc: "Modern Forge fork. 1.20.2+" },
];

const RAM_OPTIONS = [512, 1024, 2048, 4096, 8192];

export default function CreateServerModal({ onClose, onCreated }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [serverType, setServerType] = useState<ServerType>("paper");
  const [versions, setVersions] = useState<McVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [port, setPort] = useState(25565);
  const [ram, setRam] = useState(2048);

  useEffect(() => {
    getSettings().then((s) => {
      setAppSettings(s);
      if (s.default_port) setPort(s.default_port);
      if (s.default_ram_mb) setRam(s.default_ram_mb);
    });
  }, []);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (step !== 2) return;
    setLoadingVersions(true);
    setVersions([]);
    setSelectedVersion("");
    getMcVersions(serverType)
      .then((vs) => {
        const showSnapshots = appSettings?.show_snapshots ?? false;
        const filtered = showSnapshots ? vs : vs.filter((v) => v.release_type === "release");
        setVersions(filtered);
        if (filtered.length > 0) setSelectedVersion(filtered[0].id);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingVersions(false));
  }, [step, serverType, appSettings]);

  useEffect(() => {
    if (!creating) return;
    const unlisten = listen<DownloadProgress>("download-progress", (e) => {
      setProgress(e.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [creating]);

  async function handleCreate() {
    setCreating(true);
    setError("");
    try {
      const req: CreateServerRequest = {
        name: name.trim(),
        server_type: serverType,
        minecraft_version: selectedVersion,
        port,
        max_ram_mb: ram,
      };
      await createServer(req);
      onCreated();
    } catch (e) {
      setError(String(e));
      setCreating(false);
    }
  }

  const canNext =
    step === 0
      ? name.trim().length > 0
      : step === 1
      ? !!serverType
      : step === 2
      ? !!selectedVersion
      : true;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        backdropFilter: "blur(2px)",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--color-surface-1)",
          border: "1px solid var(--color-border)",
          borderRadius: 16,
          width: 520,
          padding: 28,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              {creating ? "Creating server…" : "New Server"}
            </h2>
            {!creating && (
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-muted)" }}>
                Step {step + 1} of 4
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              padding: 4,
              borderRadius: 6,
              display: "flex",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Progress bar */}
        {!creating && (
          <div
            style={{
              height: 3,
              backgroundColor: "var(--color-surface-3)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${((step + 1) / 4) * 100}%`,
                backgroundColor: "var(--color-orange-primary)",
                transition: "width 0.3s",
              }}
            />
          </div>
        )}

        {/* Step content */}
        {creating ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "16px 0" }}>
            <Loader size={32} color="var(--color-orange-primary)" style={{ animation: "spin 1s linear infinite" }} />
            <div style={{ textAlign: "center" }}>
              <p style={{ margin: 0, fontWeight: 600 }}>
                {progress?.message ?? "Preparing…"}
              </p>
              {progress && progress.total > 0 && (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--color-text-muted)" }}>
                  {Math.round((progress.downloaded / progress.total) * 100)}% —{" "}
                  {(progress.downloaded / 1024 / 1024).toFixed(1)} /{" "}
                  {(progress.total / 1024 / 1024).toFixed(1)} MB
                </p>
              )}
            </div>
            {progress && progress.total > 0 && (
              <div
                style={{
                  width: "100%",
                  height: 6,
                  backgroundColor: "var(--color-surface-3)",
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(progress.downloaded / progress.total) * 100}%`,
                    backgroundColor: "var(--color-orange-primary)",
                    transition: "width 0.2s",
                  }}
                />
              </div>
            )}
          </div>
        ) : step === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)" }}>
              Server name
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canNext && setStep(1)}
              placeholder="My Minecraft Server"
              style={{
                padding: "10px 14px",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                background: "var(--color-surface-2)",
                color: "var(--color-text-primary)",
                fontSize: 14,
                outline: "none",
                fontFamily: "inherit",
              }}
            />
          </div>
        ) : step === 1 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)" }}>
              Server type
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {SERVER_TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setServerType(t.id)}
                  style={{
                    padding: 14,
                    borderRadius: 10,
                    border: serverType === t.id
                      ? "1px solid var(--color-orange-primary)"
                      : "1px solid var(--color-border)",
                    background: serverType === t.id
                      ? "var(--color-orange-subtle)"
                      : "var(--color-surface-2)",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s",
                  }}
                >
                  <ServerTypeIcon type={t.id} size={32} />
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginTop: 6 }}>
                    {t.label}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                    {t.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : step === 2 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)" }}>
              Minecraft version
            </label>
            {loadingVersions ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: "var(--color-text-muted)" }}>
                <Loader size={16} style={{ animation: "spin 1s linear infinite" }} />
                Loading versions…
              </div>
            ) : (
              <select
                value={selectedVersion}
                onChange={(e) => setSelectedVersion(e.target.value)}
                style={{
                  padding: "10px 14px",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  background: "var(--color-surface-2)",
                  color: "var(--color-text-primary)",
                  fontSize: 14,
                  outline: "none",
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)" }}>
                Port
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                min={1024}
                max={65535}
                style={{
                  padding: "10px 14px",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  background: "var(--color-surface-2)",
                  color: "var(--color-text-primary)",
                  fontSize: 14,
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)" }}>
                Max RAM — {ram >= 1024 ? `${ram / 1024} GB` : `${ram} MB`}
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                {RAM_OPTIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRam(r)}
                    style={{
                      flex: 1,
                      padding: "8px 4px",
                      borderRadius: 8,
                      border: ram === r
                        ? "1px solid var(--color-orange-primary)"
                        : "1px solid var(--color-border)",
                      background: ram === r
                        ? "var(--color-orange-subtle)"
                        : "var(--color-surface-2)",
                      color: ram === r ? "var(--color-orange-primary)" : "var(--color-text-secondary)",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      transition: "all 0.15s",
                    }}
                  >
                    {r >= 1024 ? `${r / 1024}G` : `${r}M`}
                  </button>
                ))}
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-muted)" }}>
              By creating this server, you agree to the{" "}
              <a
                href="https://www.minecraft.net/en-us/eula"
                target="_blank"
                style={{ color: "var(--color-orange-primary)" }}
              >
                Minecraft EULA
              </a>
              . The EULA will be auto-accepted.
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <p style={{ margin: 0, fontSize: 13, color: "#ef4444" }}>{error}</p>
        )}

        {/* Footer buttons */}
        {!creating && (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <button
              onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "9px 16px",
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
              <ChevronLeft size={14} />
              {step === 0 ? "Cancel" : "Back"}
            </button>

            <button
              disabled={!canNext}
              onClick={() => (step === 3 ? handleCreate() : setStep((s) => s + 1))}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "9px 18px",
                border: "none",
                borderRadius: 8,
                background: canNext
                  ? "var(--color-orange-primary)"
                  : "var(--color-surface-3)",
                color: canNext ? "#fff" : "var(--color-text-muted)",
                fontSize: 13,
                fontWeight: 600,
                cursor: canNext ? "pointer" : "not-allowed",
                fontFamily: "inherit",
                transition: "background 0.15s",
              }}
            >
              {step === 3 ? "Create Server" : "Continue"}
              {step < 3 && <ChevronRight size={14} />}
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}
