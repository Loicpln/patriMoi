import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";

export default function Parametres() {
  const [pdfFolder, setPdfFolder] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    invoke<string>("get_parametre", { cle: "pdf_folder" }).then(setPdfFolder).catch(() => {});
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

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Paramètres</h1>
        <p className="page-sub">Configuration de l'application</p>
      </div>

      <div className="table-card" style={{ maxWidth: 600 }}>
        <div className="table-head">
          <span className="table-head-title">Dossier des fiches de paie</span>
        </div>
        <div style={{ padding: "24px" }}>
          <p style={{ color: "var(--text-1)", fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
            Sélectionnez le dossier local où vous rangez vos fichiers PDF de fiches de paie.
            L'application les listera automatiquement lors de l'ajout d'une fiche.
          </p>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Chemin du dossier</label>
              <input
                value={pdfFolder}
                onChange={e => setPdfFolder(e.target.value)}
                placeholder="/Users/vous/Documents/Fiches de paie"
                style={{ width: "100%" }}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-ghost" onClick={chooseFolder}>📁 Parcourir…</button>
            <button className="btn btn-primary" onClick={save}>{saved ? "✓ Sauvegardé" : "Sauvegarder"}</button>
          </div>
          {pdfFolder && (
            <div style={{ marginTop: 16, padding: "10px 14px", background: "var(--bg-2)", borderRadius: 6, fontSize: 11, color: "var(--teal)", fontFamily: "var(--mono)" }}>
              {pdfFolder}
            </div>
          )}
        </div>
      </div>

      <div className="table-card" style={{ maxWidth: 600, marginTop: 20 }}>
        <div className="table-head">
          <span className="table-head-title">À propos</span>
        </div>
        <div style={{ padding: "24px" }}>
          <div style={{ display: "grid", gap: 10 }}>
            {[
              ["Application", "Patrimo"],
              ["Version", "0.2.0"],
              ["Stack", "Tauri + React + TypeScript + SQLite"],
              ["Cours boursiers", "Yahoo Finance (temps réel, sans clé API)"],
              ["Base de données", "~/Library/Application Support/com.patrimo.app/patrimoine.db"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: 12 }}>
                <span style={{ color: "var(--text-2)", fontSize: 11, width: 160, flexShrink: 0 }}>{k}</span>
                <span style={{ color: "var(--text-0)", fontSize: 11 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
