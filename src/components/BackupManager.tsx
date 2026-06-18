import { useEffect, useState } from "react";
import { Archive, Download, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import type { BackupInfo } from "../types";
import { createBackup, deleteBackup, listBackups, restoreBackup } from "../lib/tauri";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function BackupManager({ serverId }: { serverId: string }) {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try { setBackups(await listBackups(serverId)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [serverId]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      await createBackup(serverId, label || undefined);
      setLabel("");
      await load();
    } catch (e) { setError(String(e)); }
    finally { setCreating(false); }
  }

  async function handleRestore(name: string) {
    setError(null);
    try { await restoreBackup(serverId, name); setConfirmRestore(null); }
    catch (e) { setError(String(e)); setConfirmRestore(null); }
  }

  async function handleDelete(name: string) {
    try { await deleteBackup(serverId, name); setConfirmDelete(null); await load(); }
    catch (e) { setError(String(e)); setConfirmDelete(null); }
  }

  return (
    <div style={{ padding: "20px 28px", display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Create backup */}
      <div style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)", borderRadius: 10, padding: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Create Backup</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="Label (optional)"
            style={{ flex: 1, padding: "8px 12px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-text-primary)", fontSize: 13, fontFamily: "inherit", outline: "none" }}
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", border: "none", borderRadius: 7, background: "var(--color-orange-primary)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: creating ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: creating ? 0.6 : 1 }}
          >
            <UploadCloud size={14} />
            {creating ? "Creating…" : "Create Backup"}
          </button>
        </div>
        {error && <p style={{ marginTop: 10, fontSize: 12, color: "#ef4444" }}>{error}</p>}
      </div>

      {/* List */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Saved Backups</span>
        <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", border: "1px solid var(--color-border)", borderRadius: 6, background: "transparent", color: "var(--color-text-secondary)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {loading ? (
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Loading…</p>
      ) : backups.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--color-text-muted)" }}>
          <Archive size={36} strokeWidth={1} style={{ margin: "0 auto 10px" }} />
          <p style={{ margin: 0, fontSize: 14 }}>No backups yet</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {backups.map(b => (
            <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 8, background: "var(--color-surface-1)", border: "1px solid var(--color-border)" }}>
              <Archive size={16} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{formatDate(b.created_at)} · {formatBytes(b.size)}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setConfirmRestore(b.name)} title="Restore" style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", border: "1px solid var(--color-border)", borderRadius: 6, background: "transparent", color: "var(--color-text-secondary)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                  <Download size={13} /> Restore
                </button>
                <button onClick={() => setConfirmDelete(b.name)} title="Delete" style={{ display: "flex", alignItems: "center", padding: "6px 8px", border: "1px solid var(--color-border)", borderRadius: 6, background: "transparent", color: "#ef4444", cursor: "pointer" }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Restore confirm */}
      {confirmRestore && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)", borderRadius: 12, padding: 24, maxWidth: 380, width: "90%" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Restore Backup?</div>
            <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: "0 0 20px" }}>This will overwrite current server files with <strong>{confirmRestore}</strong>. The server must be stopped.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmRestore(null)} style={{ padding: "8px 14px", border: "1px solid var(--color-border)", borderRadius: 7, background: "transparent", color: "var(--color-text-secondary)", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
              <button onClick={() => handleRestore(confirmRestore)} style={{ padding: "8px 14px", border: "none", borderRadius: 7, background: "var(--color-orange-primary)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Restore</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)", borderRadius: 12, padding: 24, maxWidth: 380, width: "90%" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Delete Backup?</div>
            <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: "0 0 20px" }}>This will permanently delete <strong>{confirmDelete}</strong>.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmDelete(null)} style={{ padding: "8px 14px", border: "1px solid var(--color-border)", borderRadius: 7, background: "transparent", color: "var(--color-text-secondary)", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} style={{ padding: "8px 14px", border: "none", borderRadius: 7, background: "#ef4444", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
