import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { save, open as openDialog } from "@tauri-apps/api/dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/api/fs";
import { exportScpiValuations, importScpi } from "./patrimoine/InvestSettings";

// ── Helpers ───────────────────────────────────────────────────────────────
function todayStr(): string { return new Date().toISOString().slice(0, 10); }

function withDate(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? `${name.slice(0, dot)}_${todayStr()}${name.slice(dot)}` : `${name}_${todayStr()}`;
}

// ── CSV utilities ──────────────────────────────────────────────────────────
function esc(v: any): string {
  if (v == null) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: any[][]): string {
  return [headers.join(","), ...rows.map(r => r.map(esc).join(","))].join("\n");
}

async function downloadCsv(filename: string, content: string) {
  const path = await save({ defaultPath: filename, filters: [{ name: "CSV", extensions: ["csv"] }] });
  if (!path) return;
  await writeTextFile(path, "\uFEFF" + content);
}

// ── CSV parser ────────────────────────────────────────────────────────────
function parseCsvContent(raw: string): string[][] {
  const content = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = content.split("\n").filter(l => l.trim() !== "");
  return lines.map(line => {
    const row: string[] = []; let inQ = false, cur = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } }
      else if (c === "," && !inQ) { row.push(cur); cur = ""; }
      else { cur += c; }
    }
    row.push(cur);
    return row;
  });
}

function num(s: string): number  { return parseFloat(s) || 0; }
function str(s: string): string | null { const t = s.trim(); return t === "" ? null : t; }

// ── CSV → struct converters ────────────────────────────────────────────────
function csvToDepenses(rows: string[][]): any[] {
  return rows.slice(1).map(r => ({
    id: null, date: r[1]?.trim(), categorie: r[2]?.trim(),
    sous_categorie: r[3]?.trim(), libelle: r[4]?.trim(),
    montant: num(r[5]), notes: str(r[6] ?? ""),
  }));
}

function csvToSalaires(rows: string[][]): any[] {
  return rows.slice(1).map(r => {
    const typeVal = r[2]?.trim() ?? "";
    const isP = typeVal !== "Fiche de paie";
    const notesRaw = str(r[7] ?? "") ?? "";
    return {
      id: null, date: r[1]?.trim(),
      salaire_brut: num(r[3]), salaire_net: num(r[4]),
      primes: r[5]?.trim() ? num(r[5]) : null,
      employeur: isP ? "_PRIME" : (r[6]?.trim() || ""),
      pdf_path: null,
      notes: isP ? (`[PRIME:${typeVal}] ${notesRaw}`).trim() || null : (notesRaw || null),
    };
  });
}

function csvToLivrets(rows: string[][]): any[] {
  return rows.slice(1).map(r => ({
    id: null, poche: r[1]?.trim(), date: r[2]?.trim(),
    montant: num(r[3]), taux: num(r[4]), notes: str(r[5] ?? ""),
  }));
}

// ── Import functions ───────────────────────────────────────────────────────
async function importDepenses(rows: string[][], replace: boolean): Promise<number> {
  return invoke<number>("import_depenses", { rows: csvToDepenses(rows), replace });
}
async function importSalaires(rows: string[][], replace: boolean): Promise<number> {
  return invoke<number>("import_salaires", { rows: csvToSalaires(rows), replace });
}
async function importLivrets(rows: string[][], replace: boolean): Promise<number> {
  return invoke<number>("import_livrets", { rows: csvToLivrets(rows), replace });
}

// ── Export functions ───────────────────────────────────────────────────────
async function exportDepenses() {
  const rows = await invoke<any[]>("get_depenses", {});
  downloadCsv(withDate("depenses.csv"), toCsv(
    ["id", "date", "categorie", "sous_categorie", "libelle", "montant", "notes"],
    rows.map(r => [r.id, r.date, r.categorie, r.sous_categorie, r.libelle, r.montant, r.notes])
  ));
}

async function exportSalaires() {
  const rows = await invoke<any[]>("get_salaires");
  downloadCsv(withDate("fiches_et_primes.csv"), toCsv(
    ["id", "date", "type", "salaire_brut", "salaire_net", "primes", "employeur", "notes"],
    rows.map(r => {
      const isP = r.employeur === "_PRIME";
      const type = isP
        ? ((r.notes ?? "").replace(/\[PRIME:([^\]]+)\].*/, "$1").trim() || "Prime")
        : "Fiche de paie";
      const notes = (r.notes ?? "").replace(/\[PRIME:[^\]]+\]\s*/, "");
      return [r.id, r.date, type, r.salaire_brut, r.salaire_net, r.primes ?? "", isP ? "" : r.employeur, notes];
    })
  ));
}

async function exportLivrets() {
  const rows = await invoke<any[]>("get_livrets");
  downloadCsv(withDate("livrets.csv"), toCsv(
    ["id", "poche", "date", "montant", "taux", "notes"],
    rows.map(r => [r.id, r.poche, r.date, r.montant, r.taux, r.notes])
  ));
}

// ── ExportBtn ──────────────────────────────────────────────────────────────
function ExportBtn({ label, onExport }: { label: string; onExport: () => Promise<void> }) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const handle = async () => {
    setState("loading");
    try { await onExport(); setState("done"); setTimeout(() => setState("idle"), 2000); }
    catch { setState("idle"); }
  };
  return (
    <button className="btn btn-ghost btn-sm"
      style={{ fontSize: 10, minWidth: 90, opacity: state === "loading" ? 0.6 : 1 }}
      disabled={state === "loading"} onClick={handle}>
      {state === "loading" ? "…" : state === "done" ? "✓ OK" : `↓ ${label}`}
    </button>
  );
}

// ── ImportModal ────────────────────────────────────────────────────────────
type ImportPending = { label: string; rowCount: number; onConfirm: (replace: boolean) => Promise<void>; };

function ImportModal({ pending, onClose }: { pending: ImportPending; onClose: () => void }) {
  const [state, setState] = useState<"idle" | "loading">("idle");
  const handle = async (replace: boolean) => {
    setState("loading");
    try { await pending.onConfirm(replace); onClose(); }
    catch (e) { alert("Erreur : " + e); setState("idle"); }
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)",
      display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div style={{ background:"var(--bg-1)", border:"1px solid var(--border)", borderRadius:12,
        padding:"28px 32px", minWidth:380, maxWidth:440 }}>
        <div style={{ fontSize:13, fontWeight:600, color:"var(--text-0)", marginBottom:8 }}>
          Importer — {pending.label}
        </div>
        <div style={{ fontSize:11, color:"var(--text-2)", marginBottom:24 }}>
          {pending.rowCount} ligne{pending.rowCount > 1 ? "s" : ""} détectée{pending.rowCount > 1 ? "s" : ""} dans le fichier.
          <br/>Comment voulez-vous importer ?
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <button className="btn btn-primary" disabled={state === "loading"}
            onClick={() => handle(false)} style={{ textAlign:"left", padding:"12px 16px" }}>
            <div style={{ fontSize:12, fontWeight:600 }}>Ajouter</div>
            <div style={{ fontSize:10, opacity:0.75, marginTop:2 }}>Ajoute les lignes sans toucher aux données existantes</div>
          </button>
          <button className="btn btn-ghost" disabled={state === "loading"}
            onClick={() => handle(true)}
            style={{ textAlign:"left", padding:"12px 16px", border:"1px solid var(--rose)", color:"var(--rose)" }}>
            <div style={{ fontSize:12, fontWeight:600 }}>Remplacer</div>
            <div style={{ fontSize:10, opacity:0.75, marginTop:2 }}>Supprime les données existantes puis importe le fichier</div>
          </button>
          <button className="btn btn-ghost btn-sm" disabled={state === "loading"} onClick={onClose} style={{ marginTop:4 }}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ImportBtn ──────────────────────────────────────────────────────────────
function ImportBtn({ label, onParsed }: {
  label: string;
  onParsed: (rows: string[][], rowCount: number) => void;
}) {
  const handle = async () => {
    const filePath = await openDialog({ filters: [{ name: "CSV", extensions: ["csv"] }], multiple: false }) as string | null;
    if (!filePath) return;
    const content = await readTextFile(filePath);
    const rows = parseCsvContent(content);
    onParsed(rows, Math.max(0, rows.length - 1));
  };
  return (
    <button className="btn btn-ghost btn-sm"
      style={{ fontSize: 10, minWidth: 70, color: "var(--text-2)" }} onClick={handle}>
      ↑ Import
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function Parametres() {
  const [pdfFolder, setPdfFolder] = useState("");
  const [saved, setSaved] = useState(false);
  const [importPending, setImportPending] = useState<ImportPending | null>(null);

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

  function makeImportHandler(
    label: string,
    importFn: (rows: string[][], replace: boolean) => Promise<number>,
  ) {
    return (rows: string[][], rowCount: number) => {
      setImportPending({ label, rowCount, onConfirm: async (replace) => { await importFn(rows, replace); } });
    };
  }

  const EXPORTS = [
    { label: "Dépenses",               color: "var(--rose)",   exports: [{ name: "depenses.csv",          fn: exportDepenses        }], importFn: importDepenses  },
    { label: "Fiches de paie & Primes", color: "var(--teal)",  exports: [{ name: "fiches_et_primes.csv",  fn: exportSalaires        }], importFn: importSalaires  },
    { label: "Livrets",                 color: "var(--gold)",  exports: [{ name: "livrets.csv",           fn: exportLivrets         }], importFn: importLivrets   },
    { label: "Valorisations SCPI",      color: "var(--text-2)", exports: [{ name: "scpi_valorisations.csv", fn: exportScpiValuations }], importFn: importScpi      },
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

      {/* Export / Import CSV (hors investissements) */}
      <div className="table-card" style={{ marginTop: 20 }}>
        <div className="table-head">
          <span className="table-head-title">Export / Import CSV</span>
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
                {exports.map(e => <ExportBtn key={e.name} label={e.name} onExport={e.fn}/>)}
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
              ["Application", "Patrimo"],
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
