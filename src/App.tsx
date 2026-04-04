import { useState } from "react";
import "./App.css";
import { DeviseProvider, useDevise, DEVISES } from "./context/DeviseContext";
import Dashboard  from "./pages/Dashboard";
import Depenses   from "./pages/Depenses";
import Fiches     from "./pages/Fiches";
import Patrimoine from "./pages/Patrimoine";
import Parametres from "./pages/Parametres";

export type Page = "dashboard" | "depenses" | "fiches" | "patrimoine" | "parametres";

const NAV = [
  { id: "dashboard"  as Page, icon: "◈", label: "Vue d'ensemble" },
  { id: "depenses"   as Page, icon: "◉", label: "Dépenses" },
  { id: "fiches"     as Page, icon: "◎", label: "Fiches de paie" },
  { id: "patrimoine" as Page, icon: "◆", label: "Patrimoine" },
];

function Shell() {
  const [page, setPage] = useState<Page>("dashboard");
  const { devise, setDevise } = useDevise();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-hex">⬡</span>
          <span className="brand-name">Patrimo</span>
        </div>

        <span className="nav-section-label">Navigation</span>
        {NAV.map((n) => (
          <button key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
            <span className="nav-icon">{n.icon}</span>
            <span>{n.label}</span>
          </button>
        ))}

        <span className="nav-section-label" style={{ marginTop: 12 }}>Configuration</span>
        <button className={`nav-item ${page === "parametres" ? "active" : ""}`} onClick={() => setPage("parametres")}>
          <span className="nav-icon">⚙</span>
          <span>Paramètres</span>
        </button>

        {/* Devise selector */}
        <div className="devise-selector">
          <span className="nav-section-label" style={{ padding: "0 0 6px" }}>Devise d'affichage</span>
          <div className="devise-grid">
            {(Object.keys(DEVISES) as Array<keyof typeof DEVISES>).map(d => (
              <button
                key={d}
                className={`devise-btn ${devise.code === d ? "active" : ""}`}
                onClick={() => setDevise(d)}
              >
                {DEVISES[d].symbol} {d}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-bottom">v0.3.0 · Patrimo</div>
      </aside>

      <main className="main-content">
        {page === "dashboard"  && <Dashboard  onNavigate={setPage} />}
        {page === "depenses"   && <Depenses />}
        {page === "fiches"     && <Fiches />}
        {page === "patrimoine" && <Patrimoine />}
        {page === "parametres" && <Parametres />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <DeviseProvider>
      <Shell />
    </DeviseProvider>
  );
}
