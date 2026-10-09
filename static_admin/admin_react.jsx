/**
 * Milky Mist — Internal HR Portal
 * React 18 Enterprise UI Layer & State Controller
 */

const { useState, useEffect, useRef, useCallback } = React;

// ============================================================================
// 1. React Command Palette Component (Ctrl+K / Cmd+K)
// ============================================================================
function ReactCommandPalette({ isOpen, onClose, onNavigate }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    if (!isOpen) {
      setQuery("");
    }
  }, [isOpen]);

  const commands = [
    { id: "mod_rec", title: "Applications Received", module: "recruitment", cat: "Navigation" },
    { id: "mod_app", title: "Approved Resumes", module: "approved", cat: "Navigation" },
    { id: "mod_pipe", title: "Recruitment Pipeline", module: "recruitment_pipeline", cat: "Navigation" },
    { id: "mod_emp", title: "Onboarded Employees", module: "employees", cat: "Navigation" },
    { id: "mod_task", title: "Tasks & Reminders", module: "tasks", cat: "Navigation" },
    { id: "mod_audit", title: "System Audit Trail", module: "audit", cat: "Navigation" },
    { id: "mod_users", title: "User Management", module: "users", cat: "Navigation" },
    { id: "mod_set", title: "Portal Settings", module: "settings", cat: "Navigation" },
    { id: "act_task", title: "Create New Task", action: () => window.openCreateTaskModal && window.openCreateTaskModal(), cat: "Actions" },
    { id: "act_emp", title: "Add New Employee", action: () => window.openAddEmployeeModal && window.openAddEmployeeModal(), cat: "Actions" },
    { id: "act_ref", title: "Refresh All Data", action: () => { window.fetchStats && window.fetchStats(); window.fetchCandidates && window.fetchCandidates(); }, cat: "Actions" },
    { id: "act_theme", title: "Toggle Dark/Light Mode", action: () => {
        const current = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        if (window.setTheme) window.setTheme(current);
        else {
          document.documentElement.setAttribute("data-theme", current);
          localStorage.setItem("theme", current);
        }
      }, cat: "Actions" },
  ];

  const filtered = commands.filter((c) =>
    c.title.toLowerCase().includes(query.toLowerCase()) ||
    c.cat.toLowerCase().includes(query.toLowerCase())
  );

  const handleSelect = (cmd) => {
    onClose();
    if (cmd.module) {
      if (typeof window.switchModule === "function") {
        window.switchModule(cmd.module);
      } else {
        const btn = document.querySelector(`[data-module="${cmd.module}"]`);
        btn?.click();
      }
    } else if (cmd.action) {
      cmd.action();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "95%",
          maxWidth: "580px",
          background: "var(--bg-card, #ffffff)",
          border: "1px solid var(--border-color, #e2e8f0)",
          borderRadius: "12px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          overflow: "hidden",
          animation: "modalFadeIn 0.15s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "0.85rem 1.15rem",
            borderBottom: "1px solid var(--border-color, #e2e8f0)",
            gap: "0.75rem",
          }}
        >
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Search:</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or jump to module..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: "0.95rem",
              background: "transparent",
              color: "var(--text-primary, #0f172a)",
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && filtered.length > 0) {
                handleSelect(filtered[0]);
              }
            }}
          />
          <kbd
            style={{
              fontSize: "0.7rem",
              padding: "0.2rem 0.4rem",
              background: "var(--bg-subtle, #f1f5f9)",
              border: "1px solid var(--border-color, #cbd5e1)",
              borderRadius: "4px",
              color: "var(--text-muted, #64748b)",
            }}
          >
            ESC
          </kbd>
        </div>

        <div style={{ maxHeight: "360px", overflowY: "auto", padding: "0.5rem" }}>
          {filtered.length === 0 ? (
            <div
              style={{
                padding: "2rem",
                textAlign: "center",
                color: "var(--text-muted, #64748b)",
                fontSize: "0.85rem",
              }}
            >
              No matching commands or navigation shortcuts
            </div>
          ) : (
            filtered.map((cmd) => (
              <div
                key={cmd.id}
                onClick={() => handleSelect(cmd)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.65rem 0.85rem",
                  borderRadius: "6px",
                  cursor: "pointer",
                  transition: "background 0.15s ease",
                  fontSize: "0.875rem",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-subtle, #f1f5f9)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 500, color: "var(--text-primary, #0f172a)" }}>
                    {cmd.title}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: "0.72rem",
                    padding: "0.15rem 0.5rem",
                    borderRadius: "4px",
                    background: "var(--badge-bg, rgba(37, 99, 235, 0.08))",
                    color: "var(--blue, #2563eb)",
                    fontWeight: 600,
                  }}
                >
                  {cmd.cat}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 2. React Header Badge & Live Status Component
// ============================================================================
function ReactHeaderSyncWidget({ onOpenPalette }) {
  const [isLive, setIsLive] = useState(true);
  const [lastSync, setLastSync] = useState(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

  const handleManualSync = () => {
    setIsLive(false);
    if (typeof window.fetchStats === "function") window.fetchStats();
    if (typeof window.fetchCandidates === "function") window.fetchCandidates();
    setTimeout(() => {
      setIsLive(true);
      setLastSync(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      if (typeof window.showToast === "function") {
        window.showToast("Live data refreshed", "success");
      }
    }, 400);
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
      {/* React Engine Badge */}
      <div
        title="Frontend running on React 18 Component Engine"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
          background: "rgba(59, 130, 246, 0.08)",
          border: "1px solid rgba(59, 130, 246, 0.25)",
          color: "var(--blue, #2563eb)",
          padding: "0.22rem 0.55rem",
          borderRadius: "999px",
          fontSize: "0.72rem",
          fontWeight: 700,
          letterSpacing: "0.02em",
          cursor: "default",
          userSelect: "none",
        }}
      >
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: "#2563eb",
            boxShadow: "0 0 6px rgba(37, 99, 235, 0.6)",
            animation: "pulse 2s infinite ease-in-out",
          }}
        />
        <span>React 18 Active</span>
      </div>

      {/* Quick Sync Button */}
      <button
        type="button"
        onClick={handleManualSync}
        title={`Click to sync data (Last updated: ${lastSync})`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.3rem",
          background: "transparent",
          border: "1px solid var(--border-color, #cbd5e1)",
          borderRadius: "6px",
          padding: "0.25rem 0.5rem",
          fontSize: "0.75rem",
          color: "var(--text-muted, #64748b)",
          cursor: "pointer",
          fontWeight: 500,
          transition: "all 0.15s ease",
        }}
      >
        <span>Sync</span>
      </button>
    </div>
  );
}

// ============================================================================
// 3. Main React Portal Shell Component
// ============================================================================
function AdminPortalShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    // Global Keyboard Shortcut: Ctrl+K / Cmd+K
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    // Bind to the HTML command palette button if it exists
    const htmlBtn = document.getElementById("openCommandPaletteBtn");
    if (htmlBtn) {
      htmlBtn.onclick = (e) => {
        e.preventDefault();
        setPaletteOpen(true);
      };
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <>
      <ReactCommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}

// Mount React Root for Global Overlays & Command Palette
const portalRootEl = document.getElementById("reactPortalRoot");
if (portalRootEl) {
  const portalRoot = ReactDOM.createRoot(portalRootEl);
  portalRoot.render(<AdminPortalShell />);
}

// Mount Header Sync Widget into workspace-tools-wrap if present
const toolsWrap = document.querySelector(".workspace-tools-wrap");
if (toolsWrap) {
  let widgetContainer = document.getElementById("reactHeaderSyncContainer");
  if (!widgetContainer) {
    widgetContainer = document.createElement("div");
    widgetContainer.id = "reactHeaderSyncContainer";
    widgetContainer.style.display = "inline-flex";
    widgetContainer.style.alignItems = "center";
    toolsWrap.prepend(widgetContainer);
  }
  const widgetRoot = ReactDOM.createRoot(widgetContainer);
  widgetRoot.render(
    <ReactHeaderSyncWidget
      onOpenPalette={() => {
        const btn = document.getElementById("openCommandPaletteBtn");
        btn?.click();
      }}
    />
  );
}
