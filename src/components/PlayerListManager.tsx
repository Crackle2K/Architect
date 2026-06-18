import { useEffect, useState } from "react";
import { Plus, RefreshCw, Shield, Trash2, UserX } from "lucide-react";
import type { PlayerListEntry } from "../types";
import { addToPlayerList, getPlayerList, removeFromPlayerList } from "../lib/tauri";

type ListType = "whitelist" | "ops" | "banlist";

const LIST_META: Record<ListType, { label: string; icon: React.ReactNode; color: string; emptyMsg: string }> = {
  whitelist: { label: "Whitelist", icon: <Shield size={14} />, color: "#22c55e", emptyMsg: "No whitelisted players" },
  ops: { label: "Operators", icon: <Shield size={14} />, color: "var(--color-orange-primary)", emptyMsg: "No operators" },
  banlist: { label: "Banned Players", icon: <UserX size={14} />, color: "#ef4444", emptyMsg: "No banned players" },
};

export default function PlayerListManager({ serverId }: { serverId: string }) {
  const [activeList, setActiveList] = useState<ListType>("whitelist");
  const [entries, setEntries] = useState<PlayerListEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<PlayerListEntry | null>(null);

  async function load(list = activeList) {
    setLoading(true);
    setError(null);
    try { setEntries(await getPlayerList(serverId, list)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(activeList); }, [serverId, activeList]);

  async function handleAdd() {
    if (!username.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await addToPlayerList(serverId, activeList, username.trim());
      setUsername("");
      await load();
    } catch (e) { setError(String(e)); }
    finally { setAdding(false); }
  }

  async function handleRemove(entry: PlayerListEntry) {
    setError(null);
    try {
      await removeFromPlayerList(serverId, activeList, entry.uuid);
      setConfirmRemove(null);
      await load();
    } catch (e) { setError(String(e)); setConfirmRemove(null); }
  }

  const inputStyle = { padding: "8px 12px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-text-primary)", fontSize: 13, fontFamily: "inherit", outline: "none" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 2, padding: "0 28px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
        {(["whitelist", "ops", "banlist"] as ListType[]).map(lt => {
          const meta = LIST_META[lt];
          return (
            <button
              key={lt}
              onClick={() => setActiveList(lt)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", border: "none", borderBottom: activeList === lt ? `2px solid ${meta.color}` : "2px solid transparent", background: "transparent", color: activeList === lt ? meta.color : "var(--color-text-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginBottom: -1 }}
            >
              {meta.icon}
              {meta.label}
              <span style={{ padding: "1px 6px", borderRadius: 99, fontSize: 11, backgroundColor: "var(--color-surface-3)", color: "var(--color-text-muted)" }}>
                {entries.length}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Add player */}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
            placeholder="Minecraft username…"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={() => load()}
            style={{ display: "flex", alignItems: "center", padding: "8px 10px", border: "1px solid var(--color-border)", borderRadius: 7, background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={handleAdd}
            disabled={adding || !username.trim()}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "none", borderRadius: 7, background: LIST_META[activeList].color, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: adding || !username.trim() ? 0.6 : 1 }}
          >
            <Plus size={14} />
            {adding ? "Adding…" : `Add to ${LIST_META[activeList].label}`}
          </button>
        </div>
        {error && <p style={{ fontSize: 12, color: "#ef4444", margin: 0 }}>{error}</p>}

        {loading ? (
          <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Loading…</p>
        ) : entries.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--color-text-muted)" }}>
            <p style={{ margin: 0, fontSize: 14 }}>{LIST_META[activeList].emptyMsg}</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {entries.map(entry => (
              <div key={entry.uuid} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}>
                <img
                  src={`https://mc-heads.net/avatar/${entry.name}/28`}
                  alt={entry.name}
                  width={28} height={28}
                  style={{ borderRadius: 4, imageRendering: "pixelated", flexShrink: 0 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{entry.name}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "monospace" }}>{entry.uuid}</div>
                  {entry.reason && <div style={{ fontSize: 11, color: "#ef4444" }}>Reason: {entry.reason}</div>}
                  {entry.level != null && <div style={{ fontSize: 11, color: "var(--color-orange-primary)" }}>Op Level: {entry.level}</div>}
                </div>
                <button
                  onClick={() => setConfirmRemove(entry)}
                  style={{ display: "flex", alignItems: "center", padding: "6px 8px", border: "1px solid var(--color-border)", borderRadius: 6, background: "transparent", color: "#ef4444", cursor: "pointer" }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmRemove && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)", borderRadius: 12, padding: 24, maxWidth: 360, width: "90%" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Remove {confirmRemove.name}?</div>
            <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: "0 0 20px" }}>
              Remove <strong>{confirmRemove.name}</strong> from the {LIST_META[activeList].label.toLowerCase()}?
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmRemove(null)} style={{ padding: "8px 14px", border: "1px solid var(--color-border)", borderRadius: 7, background: "transparent", color: "var(--color-text-secondary)", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
              <button onClick={() => handleRemove(confirmRemove)} style={{ padding: "8px 14px", border: "none", borderRadius: 7, background: "#ef4444", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
