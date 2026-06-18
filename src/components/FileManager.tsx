import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { FileEntry } from "../types";
import {
  deleteServerFile,
  listServerFiles,
  openServerFile,
  readServerFile,
  uploadServerFile,
  writeServerFile,
} from "../lib/tauri";

const TEXT_EXTENSIONS = new Set([
  "txt", "json", "properties", "yml", "yaml", "log", "cfg", "conf",
  "toml", "md", "sh", "bat", "xml", "ini", "env", "snbt",
]);

function isTextFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// ─── file editor modal ────────────────────────────────────────────────────────

interface FileEditorProps {
  serverId: string;
  entry: FileEntry;
  onClose: () => void;
  onSaved: () => void;
}

function FileEditor({ serverId, entry, onClose, onSaved }: FileEditorProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    readServerFile(serverId, entry.path)
      .then(setContent)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [serverId, entry.path]);

  async function handleSave() {
    if (content === null) return;
    setSaving(true);
    try {
      await writeServerFile(serverId, entry.path, content);
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "min(900px, 90vw)",
          height: "80vh",
          background: "var(--color-surface-1)",
          borderRadius: 12,
          border: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 20px",
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          <FileText size={15} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
          <span
            style={{
              flex: 1,
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
              fontSize: 12,
              color: "var(--color-text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entry.path}
          </span>
          <button
            onClick={handleSave}
            disabled={saving || loading || content === null}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              border: "none",
              borderRadius: 7,
              background: "var(--color-orange-primary)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              cursor: saving || loading || content === null ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              opacity: saving || loading || content === null ? 0.5 : 1,
            }}
          >
            <Save size={12} />
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={onClose}
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
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {error ? (
            <div style={{ padding: 20, color: "#ef4444", fontSize: 13 }}>{error}</div>
          ) : loading ? (
            <div style={{ padding: 20, color: "var(--color-text-muted)", fontSize: 13 }}>
              Loading…
            </div>
          ) : (
            <textarea
              value={content ?? ""}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              style={{
                flex: 1,
                padding: "16px 20px",
                background: "var(--color-surface-0)",
                color: "var(--color-text-primary)",
                border: "none",
                outline: "none",
                fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
                fontSize: 12,
                lineHeight: 1.7,
                resize: "none",
                width: "100%",
                boxSizing: "border-box",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── main file manager ────────────────────────────────────────────────────────

interface Props {
  serverId: string;
}

export default function FileManager({ serverId }: Props) {
  const [pathParts, setPathParts] = useState<string[]>([]);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingEntry, setEditingEntry] = useState<FileEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<FileEntry | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const subpath = pathParts.length > 0 ? pathParts.join("/") : null;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const files = await listServerFiles(serverId, subpath);
      setEntries(files);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [serverId, subpath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleEntryClick(entry: FileEntry) {
    if (entry.is_dir) {
      setPathParts((prev) => [...prev, entry.name]);
    } else if (isTextFile(entry.name)) {
      setEditingEntry(entry);
    } else {
      openServerFile(serverId, entry.path).catch(console.error);
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const bytes = await file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
      const destPath = subpath ? `${subpath}/${file.name}` : file.name;
      await uploadServerFile(serverId, destPath, b64).catch(console.error);
    }
    setUploading(false);
    refresh();
  }

  async function handleDelete(entry: FileEntry) {
    try {
      await deleteServerFile(serverId, entry.path);
    } catch (e) {
      console.error(e);
    }
    setConfirmDelete(null);
    refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Breadcrumb bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "10px 28px",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
          minHeight: 44,
        }}
      >
        {pathParts.length > 0 && (
          <button
            onClick={() => setPathParts((p) => p.slice(0, -1))}
            title="Go up"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--color-text-muted)",
              display: "flex",
              padding: "4px 6px",
              borderRadius: 6,
              marginRight: 2,
            }}
          >
            <ArrowLeft size={14} />
          </button>
        )}

        <button
          onClick={() => setPathParts([])}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
            color:
              pathParts.length === 0
                ? "var(--color-orange-primary)"
                : "var(--color-text-secondary)",
            padding: "2px 4px",
            borderRadius: 4,
            fontFamily: "inherit",
          }}
        >
          root
        </button>

        {pathParts.map((part, i) => (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <ChevronRight size={13} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
            <button
              onClick={() => setPathParts(pathParts.slice(0, i + 1))}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
                color:
                  i === pathParts.length - 1
                    ? "var(--color-orange-primary)"
                    : "var(--color-text-secondary)",
                padding: "2px 4px",
                borderRadius: 4,
                fontFamily: "inherit",
              }}
            >
              {part}
            </button>
          </span>
        ))}

        <div style={{ flex: 1 }} />

        <button
          onClick={refresh}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
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

        <button
          onClick={() => uploadRef.current?.click()}
          disabled={uploading}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", border: "1px solid var(--color-border)", borderRadius: 7, background: "transparent", color: "var(--color-text-secondary)", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", opacity: uploading ? 0.6 : 1 }}
        >
          <Upload size={12} />
          {uploading ? "Uploading…" : "Upload"}
        </button>
        <input
          ref={uploadRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={e => handleUpload(e.target.files)}
        />

        <button
          onClick={() => openServerFile(serverId, subpath).catch(console.error)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
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
          <ExternalLink size={12} />
          Open in Explorer
        </button>
      </div>

      {/* File list */}
      {loading ? (
        <div style={{ padding: "20px 28px", color: "var(--color-text-muted)", fontSize: 13 }}>
          Loading…
        </div>
      ) : entries.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "48px 0",
            gap: 10,
            color: "var(--color-text-muted)",
          }}
        >
          <FolderOpen size={36} strokeWidth={1} />
          <p style={{ margin: 0, fontSize: 14 }}>Empty folder</p>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {/* Column headers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 80px 150px 52px",
              padding: "7px 28px",
              borderBottom: "1px solid var(--color-border)",
              color: "var(--color-text-muted)",
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              userSelect: "none",
            }}
          >
            <span>Name</span>
            <span>Size</span>
            <span>Modified</span>
            <span />
          </div>

          {entries.map((entry) => (
            <FileRow
              key={entry.path}
              entry={entry}
              serverId={serverId}
              onClick={() => handleEntryClick(entry)}
              onDelete={() => setConfirmDelete(entry)}
            />
          ))}
        </div>
      )}

      {/* Text editor modal */}
      {editingEntry && (
        <FileEditor
          serverId={serverId}
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSaved={() => {
            setEditingEntry(null);
            refresh();
          }}
        />
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              padding: "28px 28px 24px",
              background: "var(--color-surface-1)",
              borderRadius: 12,
              border: "1px solid var(--color-border)",
              maxWidth: 400,
              width: "90vw",
            }}
          >
            <p style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600 }}>
              Delete {confirmDelete.is_dir ? "folder" : "file"}?
            </p>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--color-text-muted)" }}>
              <span
                style={{
                  fontFamily: "monospace",
                  background: "var(--color-surface-2)",
                  padding: "1px 6px",
                  borderRadius: 4,
                }}
              >
                {confirmDelete.name}
              </span>
              {confirmDelete.is_dir && (
                <span style={{ display: "block", color: "#ef4444", marginTop: 8, fontSize: 12 }}>
                  This will permanently delete the entire folder and its contents.
                </span>
              )}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setConfirmDelete(null)}
                style={{
                  padding: "8px 16px",
                  border: "1px solid var(--color-border)",
                  borderRadius: 7,
                  background: "transparent",
                  color: "var(--color-text-secondary)",
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                style={{
                  padding: "8px 16px",
                  border: "none",
                  borderRadius: 7,
                  background: "#ef4444",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── individual file row ──────────────────────────────────────────────────────

interface FileRowProps {
  entry: FileEntry;
  serverId: string;
  onClick: () => void;
  onDelete: () => void;
}

function FileRow({ entry, serverId, onClick, onDelete }: FileRowProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 80px 150px 52px",
        padding: "0 28px",
        alignItems: "center",
        background: hovered ? "var(--color-surface-1)" : "transparent",
        transition: "background 0.1s",
        cursor: "default",
      }}
    >
      {/* Name */}
      <div
        onClick={onClick}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 0",
          cursor: "pointer",
          overflow: "hidden",
        }}
      >
        {entry.is_dir ? (
          <Folder size={15} style={{ color: "#eab308", flexShrink: 0 }} />
        ) : isTextFile(entry.name) ? (
          <FileText size={15} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
        ) : (
          <File size={15} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
        )}
        <span
          style={{
            fontSize: 13,
            color: "var(--color-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.name}
        </span>
      </div>

      {/* Size */}
      <div onClick={onClick} style={{ fontSize: 12, color: "var(--color-text-muted)", cursor: "pointer" }}>
        {entry.is_dir ? "—" : formatSize(entry.size)}
      </div>

      {/* Modified */}
      <div onClick={onClick} style={{ fontSize: 12, color: "var(--color-text-muted)", cursor: "pointer" }}>
        {formatDate(entry.modified)}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
        {!entry.is_dir && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              openServerFile(serverId, entry.path).catch(console.error);
            }}
            title="Open with system app"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: hovered ? "var(--color-text-muted)" : "transparent",
              display: "flex",
              padding: 4,
              borderRadius: 4,
              transition: "color 0.1s",
            }}
          >
            <ExternalLink size={13} />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: hovered ? "var(--color-text-muted)" : "transparent",
            display: "flex",
            padding: 4,
            borderRadius: 4,
            transition: "color 0.1s",
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
