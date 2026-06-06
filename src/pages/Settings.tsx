import { useEffect, useRef, useState } from "react";
import { FolderOpen, RotateCcw, Save } from "lucide-react";
import type { AppSettings } from "../types";
import { getDataDir, getSettings, openPath, saveSettings } from "../lib/tauri";

const RAM_OPTIONS = [512, 1024, 2048, 4096, 8192];

const sectionStyle: React.CSSProperties = {
  backgroundColor: "var(--color-surface-1)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  padding: 24,
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "var(--color-text-secondary)",
  marginBottom: 6,
  display: "block",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  background: "var(--color-surface-2)",
  color: "var(--color-text-primary)",
  fontSize: 14,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: "var(--color-text-primary)",
  margin: 0,
  paddingBottom: 4,
  borderBottom: "1px solid var(--color-border)",
};

const DEFAULT_SETTINGS: AppSettings = {
  java_path: "",
  default_ram_mb: 2048,
  default_port: 25565,
  show_snapshots: false,
};

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [dataDir, setDataDir] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Promise.all([getSettings(), getDataDir()]).then(([s, d]) => {
      setSettings(s);
      setDataDir(d);
    });
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, []);

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaveState("idle");
  }

  async function handleSave() {
    try {
      await saveSettings(settings);
      setSaveState("saved");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveState("idle"), 2500);
    } catch (e) {
      setError(String(e));
      setSaveState("error");
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 660, display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Settings</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-text-muted)" }}>
          Configure Launchstone's behaviour. Changes take effect after saving.
        </p>
      </div>

      {/* Java */}
      <section style={sectionStyle}>
        <h2 style={sectionHeaderStyle}>Java</h2>
        <div>
          <label style={labelStyle}>Java executable path</label>
          <input
            style={inputStyle}
            value={settings.java_path}
            onChange={(e) => set("java_path", e.target.value)}
            placeholder="Leave blank to auto-detect from JAVA_HOME / PATH"
            spellCheck={false}
          />
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-text-muted)" }}>
            Full path to the <code>java</code> executable, e.g.{" "}
            <code>C:\Program Files\Eclipse Adoptium\jdk-21\bin\java.exe</code>
          </p>
        </div>
      </section>

      {/* New-server defaults */}
      <section style={sectionStyle}>
        <h2 style={sectionHeaderStyle}>New-server defaults</h2>
        <div>
          <label style={labelStyle}>
            Default RAM — {settings.default_ram_mb >= 1024
              ? `${settings.default_ram_mb / 1024} GB`
              : `${settings.default_ram_mb} MB`}
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            {RAM_OPTIONS.map((r) => (
              <button
                key={r}
                onClick={() => set("default_ram_mb", r)}
                style={{
                  flex: 1,
                  padding: "8px 4px",
                  borderRadius: 8,
                  border: settings.default_ram_mb === r
                    ? "1px solid var(--color-orange-primary)"
                    : "1px solid var(--color-border)",
                  background: settings.default_ram_mb === r
                    ? "var(--color-orange-subtle)"
                    : "var(--color-surface-2)",
                  color: settings.default_ram_mb === r
                    ? "var(--color-orange-primary)"
                    : "var(--color-text-secondary)",
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
        <div>
          <label style={labelStyle}>Default port</label>
          <input
            style={{ ...inputStyle, width: 160 }}
            type="number"
            value={settings.default_port}
            onChange={(e) => set("default_port", Number(e.target.value))}
            min={1024}
            max={65535}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)" }}>
              Show snapshots
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 2 }}>
              Include snapshot versions when selecting a Minecraft version
            </div>
          </div>
          <button
            onClick={() => set("show_snapshots", !settings.show_snapshots)}
            style={{
              width: 42,
              height: 24,
              borderRadius: 12,
              border: "none",
              background: settings.show_snapshots ? "var(--color-orange-primary)" : "var(--color-surface-3)",
              cursor: "pointer",
              position: "relative",
              transition: "background 0.2s",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 3,
                left: settings.show_snapshots ? 21 : 3,
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "#fff",
                transition: "left 0.2s",
              }}
            />
          </button>
        </div>
      </section>

      {/* Data */}
      <section style={sectionStyle}>
        <h2 style={sectionHeaderStyle}>Data</h2>
        <div>
          <label style={labelStyle}>Data directory</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...inputStyle, color: "var(--color-text-muted)", cursor: "default" }}
              value={dataDir}
              readOnly
            />
            <button
              onClick={() => openPath(dataDir)}
              title="Open in file explorer"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "10px 14px",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                background: "var(--color-surface-2)",
                color: "var(--color-text-secondary)",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
                transition: "all 0.15s",
              }}
            >
              <FolderOpen size={15} />
              Open
            </button>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-text-muted)" }}>
            Server configs and world data are stored here.
          </p>
        </div>
      </section>

      {/* Save bar */}
      {error && (
        <p style={{ margin: 0, fontSize: 13, color: "#ef4444" }}>{error}</p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          onClick={handleSave}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "10px 20px",
            border: "none",
            borderRadius: 8,
            background: "var(--color-orange-primary)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "opacity 0.15s",
          }}
        >
          <Save size={15} />
          Save settings
        </button>
        <button
          onClick={() => getSettings().then(setSettings)}
          title="Reset to saved values"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 14px",
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
          <RotateCcw size={14} />
          Reset
        </button>
        {saveState === "saved" && (
          <span style={{ fontSize: 13, color: "#22c55e", fontWeight: 500 }}>Saved!</span>
        )}
      </div>
    </div>
  );
}
