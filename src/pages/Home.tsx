import { useEffect, useState } from "react";
import { Plus, RefreshCw, Server } from "lucide-react";
import type { ServerInfo } from "../types";
import { deleteServer, listServers } from "../lib/tauri";
import ServerCard from "../components/ServerCard";
import CreateServerModal from "../components/CreateServerModal";

export default function Home() {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  async function refresh() {
    try {
      const data = await listServers();
      setServers(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleDelete(id: string) {
    if (!confirm("Delete this server? This will permanently remove all server files.")) return;
    try {
      await deleteServer(id);
      refresh();
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div style={{ padding: 28 }}>
      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Servers</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-muted)" }}>
            {servers.length} server{servers.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={refresh}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "9px 14px",
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
            <RefreshCw size={14} />
            Refresh
          </button>

          <button
            onClick={() => setShowCreate(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "9px 16px",
              border: "none",
              borderRadius: 8,
              background: "var(--color-orange-primary)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <Plus size={14} />
            New Server
          </button>
        </div>
      </div>

      {/* Server grid */}
      {loading ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              style={{
                height: 168,
                borderRadius: 12,
                backgroundColor: "var(--color-surface-1)",
                border: "1px solid var(--color-border)",
                opacity: 0.5,
              }}
            />
          ))}
        </div>
      ) : servers.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            padding: "80px 0",
            color: "var(--color-text-muted)",
          }}
        >
          <Server size={44} strokeWidth={1} />
          <div style={{ textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--color-text-secondary)" }}>
              No servers yet
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 13 }}>
              Create your first server to get started.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 20px",
              border: "none",
              borderRadius: 8,
              background: "var(--color-orange-primary)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              marginTop: 4,
            }}
          >
            <Plus size={14} />
            New Server
          </button>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {servers.map((s) => (
            <ServerCard
              key={s.id}
              server={s}
              onRefresh={refresh}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateServerModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
