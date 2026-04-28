import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  ExportBtn, ImportBtn, ImportModal, ImportPending,
  exportDepenses, exportSalaires,
  importDepenses, importSalaires, importLivrets,
  exportScpiValuations, importScpi,
  exportPoche, importPoche,
  exportLivretPoche, importLivretOps,
  exportParisPoche, importParisPoche,
} from "./patrimoine/InvestSettings";
import { usePoches } from "../context/PochesContext";
import { LIVRETS_DEF } from "../constants";
import type { LivretPoche } from "./patrimoine/types";

interface ParisPoche {
  id?: number;
  nom: string;
  couleur: string;
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function Parametres() {
  const [pdfFolder, setPdfFolder] = useState("");
  const [saved, setSaved] = useState(false);
  const [importPending, setImportPending] = useState<ImportPending | null>(null);
  const [exportAllState, setExportAllState] = useState<"idle"|"loading"|"done"|"error">("idle");
  const [livretPoches, setLivretPoches] = useState<LivretPoche[]>([]);
  const [parisPoches, setParisPoches] = useState<ParisPoche[]>([]);
  const { poches } = usePoches();

  useEffect(() => {
    invoke<string>("get_parametre", { cle: "pdf_folder" }).then(setPdfFolder).catch(() => {});
    invoke<LivretPoche[]>("get_livret_poches").then(setLivretPoches).catch(() => {});
    invoke<ParisPoche[]>("get_paris_poches").then(setParisPoches).catch(() => {});
  }, []);

  const chooseFolder = async () => {
    const folder = await invoke<string>("choose_folder").catch(() => "");
    if (folder) setPdfFolder(folder);
  };

  const save = async () => {
    await invoke("set_parametre", { cle: "pdf_folder", valeur: pdfFolder });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  function makeImportHandler(
    label: string,
    importFn: (rows: string[][], replace: boolean) => Promise<number>,
  ) {
    return (rows: string[][], rowCount: number) => {
      setImportPending({ label, rowCount, onConfirm: async (replace) => { await importFn(rows, replace); } });
    };
  }

  const handleExportAll = async () => {
    setExportAllState("loading");
    try {
      const subfolder = await invoke<string>("choose_export_folder");
      if (!subfolder) { setExportAllState("idle"); return; }
      await invoke("export_all_csv", { subfolder, livretPoches });
      setExportAllState("done");
      setTimeout(() => setExportAllState("idle"), 2000);
    } catch {
      setExportAllState("error");
      setTimeout(() => setExportAllState("idle"), 2000);
    }
  };

  const [icloudState, setIcloudState] = useState<"idle"|"loading"|"done"|"error">("idle");
  const handleExportIcloud = async () => {
    setIcloudState("loading");
    try {
      await invoke<string>("export_to_icloud");
      setIcloudState("done");
      setTimeout(() => setIcloudState("idle"), 3000);
    } catch {
      setIcloudState("error");
      setTimeout(() => setIcloudState("idle"), 3000);
    }
  };

  const EXPORTS = [
    { label: "Dépenses",               color: "var(--rose)",    exports: [{ name: "depenses.csv",         fn: exportDepenses        }], importFn: importDepenses  },
    { label: "Fiches de paie & Primes", color: "var(--teal)",   exports: [{ name: "fiches_et_primes.csv", fn: exportSalaires        }], importFn: importSalaires  },
    ...livretPoches.map(p => {
      const color = LIVRETS_DEF.find(l => l.key === p.type_livret)?.color ?? "var(--gold)";
      const safeName = p.nom.replace(/[^a-z0-9]/gi, "_");
      return {
        label: `${p.nom}`,
        color,
        exports: [{ name: `${safeName}.csv`, fn: () => exportLivretPoche(p.type_livret, p.nom) }],
        importFn: importLivretOps(p.type_livret, p.nom),
      };
    }),
    ...poches.map(p => ({
      label: p.label,
      color: p.color,
      exports: [{ name: `${p.key}.csv`, fn: () => exportPoche(p.key, `${p.key}.csv`) }],
      importFn: importPoche(p.key),
    })),
    { label: "Valorisations SCPI",      color: "var(--text-2)", exports: [{ name: "scpi_valorisations.csv", fn: exportScpiValuations }], importFn: importScpi      },
    ...parisPoches.map(p => {
      const safeName = p.nom.replace(/[^a-z0-9]/gi, "_");
      return {
        label: `Paris — ${p.nom}`,
        color: p.couleur || "var(--lav)",
        exports: [{ name: `paris_${safeName}.csv`, fn: () => exportParisPoche(p.nom) }],
        importFn: importParisPoche(p.nom),
      };
    }),
  ];

  return (
    <div>
      {importPending && <ImportModal pending={importPending} onClose={() => setImportPending(null)}/>}

      <div className="page-header">
        <h1 className="page-title">Paramètres</h1>
        <p className="page-sub">Configuration de l'application</p>
      </div>

      {/* PDF folder */}
      <div className="table-card">
        <div className="table-head">
          <span className="table-head-title">Dossier des fiches de paie</span>
        </div>
        <div style={{ padding: "24px" }}>
          <p style={{ color:"var(--text-1)", fontSize:12, marginBottom:16, lineHeight:1.6 }}>
            Sélectionnez le dossier local où vous rangez vos fichiers PDF de fiches de paie.
            L'application les listera automatiquement lors de l'ajout d'une fiche.
          </p>
          <div style={{ display:"flex", gap:10, alignItems:"flex-end", marginBottom:12 }}>
            <div className="field" style={{ flex:1 }}>
              <label>Chemin du dossier</label>
              <input value={pdfFolder} onChange={e => setPdfFolder(e.target.value)}
                placeholder="/Users/vous/Documents/Fiches de paie" style={{ width:"100%" }}/>
            </div>
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button className="btn btn-ghost" onClick={chooseFolder}>📁 Parcourir…</button>
            <button className="btn btn-primary" onClick={save}>{saved ? "✓ Sauvegardé" : "Sauvegarder"}</button>
          </div>
          {pdfFolder && (
            <div style={{ marginTop:16, padding:"10px 14px", background:"var(--bg-2)", borderRadius:6,
              fontSize:11, color:"var(--teal)", fontFamily:"var(--mono)" }}>
              {pdfFolder}
            </div>
          )}
        </div>
      </div>

      {/* Export vers iPhone (iCloud Drive) */}
      <div className="table-card" style={{ marginTop: 20 }}>
        <div className="table-head">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="table-head-title">📱 iPhone — PatriMe iOS</span>
          </div>
          <button
            className={`btn btn-sm ${icloudState === "done" ? "btn-primary" : "btn-ghost"}`}
            style={{ fontSize: 10, opacity: icloudState === "loading" ? 0.6 : 1 }}
            disabled={icloudState === "loading"}
            onClick={handleExportIcloud}>
            {icloudState === "loading" ? "Export…" : icloudState === "done" ? "✓ Exporté vers iCloud" : icloudState === "error" ? "✗ Erreur" : "☁ Exporter vers iCloud Drive"}
          </button>
        </div>
        <div style={{ padding: "10px 24px", fontSize: 11, color: "var(--text-2)", lineHeight: 1.6 }}>
          Exporte <strong style={{ color: "var(--text-1)" }}>livrets.csv</strong> et toutes les poches d'investissement
          dans <code style={{ color: "var(--gold)", fontSize: 10 }}>iCloud Drive / PatriMe /</code>.
          Ouvrez ensuite l'app <strong style={{ color: "var(--text-1)" }}>PatriMe</strong> sur votre iPhone
          → Importer → sélectionnez les fichiers.
        </div>
      </div>

      {/* Export / Import CSV (hors investissements) */}
      <div className="table-card" style={{ marginTop: 20 }}>
        <div className="table-head">
          <span className="table-head-title">Export / Import CSV</span>
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 10, opacity: exportAllState === "loading" ? 0.6 : 1 }}
            disabled={exportAllState === "loading"}
            onClick={handleExportAll}>
            {exportAllState === "loading" ? "…" : exportAllState === "done" ? "✓ OK" : exportAllState === "error" ? "✗ Erreur" : "↓ Tout exporter"}
          </button>
        </div>
        <div style={{ padding: "8px 0" }}>
          {EXPORTS.map(({ label, color, exports, importFn }) => (
            <div key={label} style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:"10px 24px", borderBottom:"1px solid var(--border)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:3, height:20, borderRadius:2, background: color, flexShrink:0 }}/>
                <span style={{ fontSize:12, color:"var(--text-0)" }}>{label}</span>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                {exports.map((e: { name: string; fn: () => Promise<void> }) => <ExportBtn key={e.name} label={e.name} onExport={e.fn}/>)}
                {importFn && <ImportBtn label={label} onParsed={makeImportHandler(label, importFn)}/>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* À propos */}
      <div className="table-card" style={{ marginTop: 20 }}>
        <div className="table-head">
          <span className="table-head-title">À propos</span>
        </div>
        <div style={{ padding: "24px" }}>
          <div style={{ display:"grid", gap:10 }}>
            {[
              ["Application", "Patri'Me"],
              ["Version", "0.2.0"],
              ["Stack", "Tauri + React + TypeScript + SQLite"],
              ["Cours boursiers", "Yahoo Finance (temps réel, sans clé API)"],
              ["Base de données", "~/Library/Application Support/com.patrimo.app/patrimoine.db"],
            ].map(([k, v]) => (
              <div key={k} style={{ display:"flex", gap:12 }}>
                <span style={{ color:"var(--text-2)", fontSize:11, width:160, flexShrink:0 }}>{k}</span>
                <span style={{ color:"var(--text-0)", fontSize:11 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
