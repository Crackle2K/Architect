import { useEffect, useState } from "react";
import { Clock, Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import type { ScheduledAction, ScheduledTask } from "../types";
import { addScheduledTask, getScheduledTasks, removeScheduledTask, updateScheduledTask } from "../lib/tauri";

function formatDate(iso: string | null) {
  if (!iso) return "Never";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function SchedulerManager({ serverId }: { serverId: string }) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [label, setLabel] = useState("");
  const [interval, setInterval] = useState(60);
  const [actionType, setActionType] = useState<"command" | "restart">("command");
  const [command, setCommand] = useState("");

  async function load() {
    setLoading(true);
    try { setTasks(await getScheduledTasks(serverId)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [serverId]);

  async function handleAdd() {
    if (!label.trim()) return;
    setError(null);
    const action: ScheduledAction = actionType === "restart"
      ? { type: "restart" }
      : { type: "command", command: command.trim() };
    try {
      await addScheduledTask(serverId, { label: label.trim(), interval_minutes: interval, action, enabled: true });
      setLabel(""); setInterval(60); setCommand(""); setShowForm(false);
      await load();
    } catch (e) { setError(String(e)); }
  }

  async function handleToggle(task: ScheduledTask) {
    try {
      await updateScheduledTask(serverId, { ...task, enabled: !task.enabled });
      await load();
    } catch (e) { setError(String(e)); }
  }

  async function handleRemove(taskId: string) {
    try { await removeScheduledTask(serverId, taskId); await load(); }
    catch (e) { setError(String(e)); }
  }

  const inputStyle = { padding: "8px 12px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-text-primary)", fontSize: 13, fontFamily: "inherit", outline: "none" };

  return (
    <div style={{ padding: "20px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Scheduled Tasks</div>
          <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Automatically run commands or restart on an interval while the server is running.</div>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "none", borderRadius: 7, background: "var(--color-orange-primary)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
        >
          <Plus size={14} /> New Task
        </button>
      </div>
      {error && <p style={{ fontSize: 12, color: "#ef4444", margin: 0 }}>{error}</p>}

      {/* Add task form */}
      {showForm && (
        <div style={{ background: "var(--color-surface-1)", border: "1px solid var(--color-border)", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>New Task</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 8 }}>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Task label…" style={inputStyle} />
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input value={interval} onChange={e => setInterval(Number(e.target.value))} type="number" min={1} style={{ ...inputStyle, width: 60 }} />
              <span style={{ fontSize: 12, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>min interval</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {(["command", "restart"] as const).map(t => (
              <button
                key={t}
                onClick={() => setActionType(t)}
                style={{ padding: "6px 14px", border: `1px solid ${actionType === t ? "var(--color-orange-primary)" : "var(--color-border)"}`, borderRadius: 6, background: actionType === t ? "var(--color-orange-primary)" : "transparent", color: actionType === t ? "#fff" : "var(--color-text-secondary)", fontSize: 13, cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize" }}
              >
                {t}
              </button>
            ))}
          </div>
          {actionType === "command" && (
            <input value={command} onChange={e => setCommand(e.target.value)} placeholder="Command (without /)…" style={inputStyle} />
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setShowForm(false)} style={{ padding: "7px 14px", border: "1px solid var(--color-border)", borderRadius: 6, background: "transparent", color: "var(--color-text-secondary)", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <button onClick={handleAdd} disabled={!label.trim()} style={{ padding: "7px 14px", border: "none", borderRadius: 6, background: "var(--color-orange-primary)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: !label.trim() ? 0.5 : 1 }}>Add Task</button>
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Loading…</p>
      ) : tasks.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--color-text-muted)" }}>
          <Clock size={36} strokeWidth={1} style={{ margin: "0 auto 10px", display: "block" }} />
          <p style={{ margin: 0, fontSize: 14 }}>No scheduled tasks</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {tasks.map(task => (
            <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 8, background: "var(--color-surface-1)", border: "1px solid var(--color-border)", opacity: task.enabled ? 1 : 0.6 }}>
              <Clock size={16} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{task.label}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                  Every {task.interval_minutes} min ·{" "}
                  {task.action.type === "restart" ? "Restart server" : `Run: ${(task.action as any).command}`}
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Last run: {formatDate(task.last_run)}</div>
              </div>
              <button
                onClick={() => handleToggle(task)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: task.enabled ? "var(--color-orange-primary)" : "var(--color-text-muted)", padding: 4 }}
                title={task.enabled ? "Disable" : "Enable"}
              >
                {task.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
              </button>
              <button
                onClick={() => handleRemove(task.id)}
                style={{ display: "flex", alignItems: "center", padding: "6px 8px", border: "1px solid var(--color-border)", borderRadius: 6, background: "transparent", color: "#ef4444", cursor: "pointer" }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
