import { Home, Settings } from "lucide-react";
import { NavLink } from "react-router-dom";

const NAV = [{ to: "/", icon: Home, label: "Servers" }];

export default function Sidebar() {
  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        backgroundColor: "var(--color-surface-1)",
        borderRight: "1px solid var(--color-border)",
        display: "flex",
        flexDirection: "column",
        padding: "16px 0",
        userSelect: "none",
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: "8px 20px 24px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "linear-gradient(135deg, #f97316, #ea580c)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
          }}
        >
          ⛏
        </div>
        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.3px",
          }}
        >
          Launchstone
        </span>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "0 8px" }}>
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end
            style={({ isActive }) => ({
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 12px",
              borderRadius: 8,
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 500,
              color: isActive
                ? "var(--color-orange-primary)"
                : "var(--color-text-secondary)",
              backgroundColor: isActive ? "var(--color-orange-subtle)" : "transparent",
              transition: "all 0.15s",
            })}
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: "0 8px" }}>
        <button
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 12px",
            width: "100%",
            border: "none",
            borderRadius: 8,
            background: "transparent",
            color: "var(--color-text-muted)",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          <Settings size={16} />
          Settings
        </button>
      </div>
    </aside>
  );
}
