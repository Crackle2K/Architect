import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import type { PropertyEntry } from "../types";
import { getServerProperties, saveServerProperties } from "../lib/tauri";

// Well-known properties with friendly labels
const KNOWN: Record<string, { label: string; type: "boolean" | "number" | "text"; description?: string }> = {
  "server-port": { label: "Server Port", type: "number" },
  "max-players": { label: "Max Players", type: "number" },
  "gamemode": { label: "Gamemode", type: "text", description: "survival, creative, adventure, spectator" },
  "difficulty": { label: "Difficulty", type: "text", description: "peaceful, easy, normal, hard" },
  "online-mode": { label: "Online Mode", type: "boolean" },
  "pvp": { label: "PvP", type: "boolean" },
  "spawn-monsters": { label: "Spawn Monsters", type: "boolean" },
  "spawn-animals": { label: "Spawn Animals", type: "boolean" },
  "spawn-npcs": { label: "Spawn NPCs", type: "boolean" },
  "allow-flight": { label: "Allow Flight", type: "boolean" },
  "allow-nether": { label: "Allow Nether", type: "boolean" },
  "enable-command-block": { label: "Command Blocks", type: "boolean" },
  "force-gamemode": { label: "Force Gamemode", type: "boolean" },
  "motd": { label: "MOTD", type: "text" },
  "level-name": { label: "World Name", type: "text" },
  "level-seed": { label: "World Seed", type: "text" },
  "level-type": { label: "World Type", type: "text", description: "minecraft:default, minecraft:flat, minecraft:large_biomes, minecraft:amplified" },
  "view-distance": { label: "View Distance", type: "number" },
  "simulation-distance": { label: "Simulation Distance", type: "number" },
  "max-build-height": { label: "Max Build Height", type: "number" },
  "white-list": { label: "Whitelist", type: "boolean" },
  "enforce-whitelist": { label: "Enforce Whitelist", type: "boolean" },
  "enable-rcon": { label: "Enable RCON", type: "boolean" },
  "rcon.port": { label: "RCON Port", type: "number" },
  "rcon.password": { label: "RCON Password", type: "text" },
  "enable-query": { label: "Enable Query", type: "boolean" },
};

export default function ServerPropertiesEditor({ serverId }: { serverId: string }) {
  const [props, setProps] = useState<PropertyEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    try { setProps(await getServerProperties(serverId)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [serverId]);

  function setValue(key: string, val: string) {
    setProps(prev => prev.map(p => p.key === key ? { ...p, value: val } : p));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveServerProperties(serverId, props);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  const filtered = props.filter(p =>
    !search || p.key.toLowerCase().includes(search.toLowerCase()) ||
    KNOWN[p.key]?.label.toLowerCase().includes(search.toLowerCase())
  );

  const knownProps = filtered.filter(p => KNOWN[p.key]);
  const otherProps = filtered.filter(p => !KNOWN[p.key]);

  if (loading) return <div style={{ padding: "20px 28px", color: "var(--color-text-muted)", fontSize: 13 }}>Loading…</div>;

  const inputStyle = {
    padding: "7px 10px",
    borderRadius: 6,
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-2)",
    color: "var(--color-text-primary)",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
  };

  return (
    <div style={{ padding: "20px 28px", display: "flex", flexDirection: "column", gap: 16, height: "100%", overflowY: "auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search properties…"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", border: "none", borderRadius: 7, background: saved ? "#22c55e" : "var(--color-orange-primary)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flexShrink: 0, transition: "background 0.2s" }}
        >
          <Save size={14} />
          {saved ? "Saved!" : saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
      {error && <p style={{ fontSize: 12, color: "#ef4444", margin: 0 }}>{error}</p>}

      {props.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>No server.properties found — start the server once to generate it.</p>
      ) : (
        <>
          {/* Known properties */}
          {knownProps.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Common Settings</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {knownProps.map(p => {
                  const meta = KNOWN[p.key];
                  return (
                    <div key={p.key} style={{ display: "grid", gridTemplateColumns: "220px 1fr", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 7, background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{meta.label}</div>
                        {meta.description && <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{meta.description}</div>}
                      </div>
                      {meta.type === "boolean" ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            onClick={() => setValue(p.key, p.value === "true" ? "false" : "true")}
                            style={{
                              width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
                              background: p.value === "true" ? "var(--color-orange-primary)" : "var(--color-surface-3)",
                              position: "relative", transition: "background 0.15s",
                            }}
                          >
                            <div style={{
                              width: 16, height: 16, borderRadius: "50%", background: "#fff",
                              position: "absolute", top: 3,
                              left: p.value === "true" ? 21 : 3,
                              transition: "left 0.15s",
                            }} />
                          </button>
                          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{p.value === "true" ? "Enabled" : "Disabled"}</span>
                        </div>
                      ) : (
                        <input
                          value={p.value}
                          onChange={e => setValue(p.key, e.target.value)}
                          type={meta.type === "number" ? "number" : "text"}
                          style={inputStyle}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Other properties */}
          {otherProps.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Advanced Settings</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {otherProps.map(p => (
                  <div key={p.key} style={{ display: "grid", gridTemplateColumns: "220px 1fr", alignItems: "center", gap: 12, padding: "8px 12px", borderRadius: 7, background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}>
                    <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.key}</div>
                    <input
                      value={p.value}
                      onChange={e => setValue(p.key, e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
