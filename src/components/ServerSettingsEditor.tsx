import { useState } from "react";
import { Save } from "lucide-react";
import type { ServerInfo, UpdateServerRequest } from "../types";
import { updateServer } from "../lib/tauri";

const RAM_OPTIONS = [512, 1024, 2048, 4096, 8192];

export default function ServerSettingsEditor({
  server,
  onSaved,
}: {
  server: ServerInfo;
  onSaved: (updated: ServerInfo) => void;
}) {
  const [name, setName] = useState(server.name);
  const [ram, setRam] = useState(server.max_ram_mb);
  const [autoRestart, setAutoRestart] = useState(server.auto_restart);
  const [jvmFlags, setJvmFlags] = useState(server.jvm_flags);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const req: UpdateServerRequest = { name: name.trim(), max_ram_mb: ram, auto_restart: autoRestart, jvm_flags: jvmFlags };
      const updated = await updateServer(server.id, req);
      onSaved({ ...server, ...updated });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  const inputStyle = { padding: "8px 12px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-text-primary)", fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%" };

  const row = (label: string, node: React.ReactNode, hint?: string) => (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--color-border)" }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{hint}</div>}
      </div>
      {node}
    </div>
  );

  return (
    <div style={{ padding: "20px 28px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Server Settings</div>
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", border: "none", borderRadius: 7, background: saved ? "#22c55e" : "var(--color-orange-primary)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "background 0.2s", opacity: !name.trim() ? 0.5 : 1 }}
        >
          <Save size={14} />
          {saved ? "Saved!" : saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
      {error && <p style={{ fontSize: 12, color: "#ef4444", margin: "0 0 10px" }}>{error}</p>}

      {row("Display Name", <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />)}
      {row("Max RAM",
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {RAM_OPTIONS.map(mb => (
            <button
              key={mb}
              onClick={() => setRam(mb)}
              style={{ padding: "6px 14px", border: `1px solid ${ram === mb ? "var(--color-orange-primary)" : "var(--color-border)"}`, borderRadius: 6, background: ram === mb ? "var(--color-orange-primary)" : "transparent", color: ram === mb ? "#fff" : "var(--color-text-secondary)", fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 500 }}
            >
              {mb >= 1024 ? `${mb / 1024}GB` : `${mb}MB`}
            </button>
          ))}
        </div>
      )}
      {row("Auto-restart on crash",
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setAutoRestart(v => !v)}
            style={{ width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer", background: autoRestart ? "var(--color-orange-primary)" : "var(--color-surface-3)", position: "relative", transition: "background 0.15s" }}
          >
            <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: autoRestart ? 21 : 3, transition: "left 0.15s" }} />
          </button>
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{autoRestart ? "Enabled" : "Disabled"}</span>
        </div>,
        "Automatically restart if the server process crashes unexpectedly"
      )}
      {row("JVM Flags",
        <input value={jvmFlags} onChange={e => setJvmFlags(e.target.value)} placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=200" style={inputStyle} />,
        "Extra JVM arguments added at startup (advanced)"
      )}

      {/* Read-only info */}
      <div style={{ marginTop: 16, padding: "12px 0", borderTop: "1px solid var(--color-border)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Server Info</div>
        {[
          ["Server ID", server.id],
          ["Type", server.server_type],
          ["Version", server.minecraft_version],
          ["Port", String(server.port)],
          ["Created", new Date(server.created_at).toLocaleString()],
        ].map(([k, v]) => (
          <div key={k} style={{ display: "flex", gap: 12, padding: "5px 0", borderBottom: "1px solid var(--color-border)" }}>
            <span style={{ width: 180, fontSize: 12, color: "var(--color-text-muted)", flexShrink: 0 }}>{k}</span>
            <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--color-text-secondary)" }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
