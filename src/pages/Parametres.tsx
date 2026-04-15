import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { save, open as openDialog } from "@tauri-apps/api/dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/api/fs";
import { usePoches, type Poche } from "../context/PochesContext";

// ── Helpers ───────────────────────────────────────────────────────────────
function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function withDate(name: string): string {
  // Insert date before the extension: pea.csv → pea_2024-01-15.csv
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
  const path = await save({
    defaultPath: filename,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return;
  await writeTextFile(path, "\uFEFF" + content);
}

// ── CSV parser (handles quoted fields) ────────────────────────────────────
function parseCsvContent(raw: string): string[][] {
  const content = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = content.split("\n").filter(l => l.trim() !== "");
  return lines.map(line => {
    const row: string[] = [];
    let inQ = false, cur = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = !inQ; }
      } else if (c === "," && !inQ) {
        row.push(cur); cur = "";
      } else { cur += c; }
    }
    row.push(cur);
    return row;
  });
}

function num(s: string): number  { return parseFloat(s) || 0; }
function str(s: string): string | null { const t = s.trim(); return t === "" ? null : t; }

// ── Per-type CSV → struct converters ──────────────────────────────────────
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

function csvToPoche(rows: string[][], poche: string) {
  const data = rows.slice(1);
  const positions = data.filter(r => r[0] === "Position").map(r => ({
    id: null, poche, ticker: r[3]?.trim(), nom: r[4]?.trim(),
    sous_categorie: str(r[5] ?? ""), quantite: num(r[6]),
    prix_achat: num(r[7]), date_achat: r[2]?.trim(), notes: str(r[11] ?? ""),
  }));
  const ventes = data.filter(r => r[0] === "Vente").map(r => ({
    id: null, poche, ticker: r[3]?.trim(), nom: r[4]?.trim(),
    quantite: num(r[6]), prix_achat: num(r[7]), prix_vente: num(r[8]),
    date_vente: r[2]?.trim(), pnl: num(r[9]), notes: str(r[11] ?? ""),
  }));
  const dividendes = data.filter(r => r[0] === "Dividende").map(r => ({
    id: null, position_id: null, ticker: r[3]?.trim(), poche,
    montant: num(r[10]), date: r[2]?.trim(), notes: str(r[11] ?? ""),
  }));
  const versements = data.filter(r => r[0] === "Versement").map(r => ({
    id: null, poche, montant: num(r[10]), date: r[2]?.trim(), notes: str(r[11] ?? ""),
  }));
  return { positions, ventes, dividendes, versements };
}

function csvToScpi(rows: string[][]): any[] {
  return rows.slice(1).map(r => ({
    id: null, ticker: r[1]?.trim(),
    mois: r[2]?.trim(), valeur_unit: num(r[3]),
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
function importPoche(pocheKey: string): (rows: string[][], replace: boolean) => Promise<number> {
  return async (rows, replace) => {
    const { positions, ventes, dividendes, versements } = csvToPoche(rows, pocheKey);
    return invoke<number>("import_poche", { poche: pocheKey, positions, ventes, dividendes, versements, replace });
  };
}
async function importScpi(rows: string[][], replace: boolean): Promise<number> {
  return invoke<number>("import_scpi_valuations", { rows: csvToScpi(rows), replace });
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

async function exportPoche(poche: string, filename: string) {
  const [positions, ventes, dividendes, versements] = await Promise.all([
    invoke<any[]>("get_positions", { poche }),
    invoke<any[]>("get_ventes",   { poche }),
    invoke<any[]>("get_dividendes", { poche }),
    invoke<any[]>("get_versements", { poche }),
  ]);
  const headers = ["type", "id", "date", "ticker", "nom", "sous_categorie",
                   "quantite", "prix_achat", "prix_vente", "pnl", "montant", "notes"];
  const rows = [
    ...positions.map(r  => ["Position",  r.id, r.date_achat,  r.ticker, r.nom, r.sous_categorie ?? "", r.quantite, r.prix_achat, "", "", "", r.notes ?? ""]),
    ...ventes.map(r     => ["Vente",     r.id, r.date_vente,  r.ticker, r.nom, "", r.quantite, r.prix_achat, r.prix_vente, r.pnl, "", r.notes ?? ""]),
    ...dividendes.map(r => ["Dividende", r.id, r.date,        r.ticker, "", "", "", "", "", "", r.montant, r.notes ?? ""]),
    ...versements.map(r => ["Versement", r.id, r.date,        "", "", "", "", "", "", "", r.montant, r.notes ?? ""]),
  ];
  downloadCsv(withDate(filename), toCsv(headers, rows));
}

async function exportScpiValuations() {
  const rows = await invoke<any[]>("get_scpi_valuations");
  downloadCsv(withDate("scpi_valorisations.csv"), toCsv(
    ["id", "ticker", "mois", "valeur_unit"],
    rows.map(r => [r.id, r.ticker, r.mois, r.valeur_unit])
  ));
}


// ── Export button ──────────────────────────────────────────────────────────
function ExportBtn({ label, onExport }: { label: string; onExport: () => Promise<void> }) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const handle = async () => {
    setState("loading");
    try { await onExport(); setState("done"); setTimeout(() => setState("idle"), 2000); }
    catch { setState("idle"); }
  };
  return (
    <button
      className="btn btn-ghost btn-sm"
      style={{ fontSize: 10, minWidth: 90, opacity: state === "loading" ? 0.6 : 1 }}
      disabled={state === "loading"}
      onClick={handle}
    >
      {state === "loading" ? "…" : state === "done" ? "✓ OK" : `↓ ${label}`}
    </button>
  );
}

// ── Import modal ───────────────────────────────────────────────────────────
type ImportPending = {
  label: string;
  rowCount: number;
  onConfirm: (replace: boolean) => Promise<void>;
};

function ImportModal({ pending, onClose }: { pending: ImportPending; onClose: () => void }) {
  const [state, setState] = useState<"idle" | "loading">("idle");

  const handle = async (replace: boolean) => {
    setState("loading");
    try { await pending.onConfirm(replace); onClose(); }
    catch (e) { alert("Erreur : " + e); setState("idle"); }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{
        background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: 12,
        padding: "28px 32px", minWidth: 380, maxWidth: 440,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-0)", marginBottom: 8 }}>
          Importer — {pending.label}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 24 }}>
          {pending.rowCount} ligne{pending.rowCount > 1 ? "s" : ""} détectée{pending.rowCount > 1 ? "s" : ""} dans le fichier.
          <br/>Comment voulez-vous importer ?
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            className="btn btn-primary"
            disabled={state === "loading"}
            onClick={() => handle(false)}
            style={{ textAlign: "left", padding: "12px 16px" }}
          >
            <div style={{ fontSize: 12, fontWeight: 600 }}>Ajouter</div>
            <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>
              Ajoute les lignes sans toucher aux données existantes
            </div>
          </button>

          <button
            className="btn btn-ghost"
            disabled={state === "loading"}
            onClick={() => handle(true)}
            style={{ textAlign: "left", padding: "12px 16px", border: "1px solid var(--rose)", color: "var(--rose)" }}
          >
            <div style={{ fontSize: 12, fontWeight: 600 }}>Remplacer</div>
            <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>
              Supprime les données existantes puis importe le fichier
            </div>
          </button>

          <button
            className="btn btn-ghost btn-sm"
            disabled={state === "loading"}
            onClick={onClose}
            style={{ marginTop: 4 }}
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Import button ──────────────────────────────────────────────────────────
function ImportBtn({
  label,
  onParsed,
}: {
  label: string;
  onParsed: (rows: string[][], rowCount: number) => void;
}) {
  const handle = async () => {
    const filePath = await openDialog({
      filters: [{ name: "CSV", extensions: ["csv"] }],
      multiple: false,
    }) as string | null;
    if (!filePath) return;
    const content = await readTextFile(filePath);
    const rows = parseCsvContent(content);
    const rowCount = Math.max(0, rows.length - 1); // minus header
    onParsed(rows, rowCount);
  };

  return (
    <button
      className="btn btn-ghost btn-sm"
      style={{ fontSize: 10, minWidth: 70, color: "var(--text-2)" }}
      onClick={handle}
    >
      ↑ Import
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function Parametres() {
  const { poches, setPoches } = usePoches();
  const [pdfFolder, setPdfFolder] = useState("");
  const [saved, setSaved] = useState(false);
  const [importPending, setImportPending] = useState<ImportPending | null>(null);
  const [exportAllState, setExportAllState] = useState<"idle"|"loading"|"done"|"error">("idle");
  const [exportAllMsg, setExportAllMsg] = useState("");

  // ── Gestion des poches ─────────────────────────────────────────────────────
  const emptyPocheForm = { key: "", label: "", color: "#3a7bd5" };
  const [pocheForm, setPocheForm] = useState<Poche>(emptyPocheForm);
  const [editingKey, setEditingKey] = useState<string | null>(null); // null = hors formulaire quand pocheFormOpen=false
  const [pocheFormOpen, setPocheFormOpen] = useState(false);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

  const startAdd = () => { setPocheForm(emptyPocheForm); setEditingKey(null); setPocheFormOpen(true); };
  const startEdit = (p: Poche) => { setPocheForm({ ...p }); setEditingKey(p.key); setPocheFormOpen(true); };
  const cancelPoche = () => { setPocheForm(emptyPocheForm); setEditingKey(null); setPocheFormOpen(false); };

  const savePoche = async () => {
    const k = pocheForm.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const l = pocheForm.label.trim();
    if (!k || !l) return;
    if (editingKey === null) {
      if (poches.some(p => p.key === k)) return alert(`La clé "${k}" existe déjà.`);
      await setPoches([...poches, { key: k, label: l, color: pocheForm.color }]);
    } else {
      await setPoches(poches.map(p => p.key === editingKey ? { key: editingKey, label: l, color: pocheForm.color } : p));
    }
    cancelPoche();
    setPocheFormOpen(false);
  };

  const deletePoche = async () => {
    if (!confirmDeleteKey) return;
    await invoke("delete_poche_data", { poche: confirmDeleteKey });
    await setPoches(poches.filter(p => p.key !== confirmDeleteKey));
    setConfirmDeleteKey(null);
  };

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
      setImportPending({
        label,
        rowCount,
        onConfirm: async (replace) => { await importFn(rows, replace); },
      });
    };
  }

  const EXPORTS = [
    { label: "Dépenses",             color: "var(--rose)",   exports: [{ name: "depenses.csv",        fn: exportDepenses  }], importFn: importDepenses  },
    { label: "Fiches de paie & Primes", color: "var(--teal)", exports: [{ name: "fiches_et_primes.csv", fn: exportSalaires  }], importFn: importSalaires  },
    { label: "Livrets",              color: "var(--gold)",   exports: [{ name: "livrets.csv",         fn: exportLivrets   }], importFn: importLivrets   },
    ...poches.map(p => ({
      label: p.label,
      color: p.color,
      exports: [{ name: `${p.key}.csv`, fn: () => exportPoche(p.key, `${p.key}.csv`) }],
      importFn: importPoche(p.key),
    })),
    { label: "Valorisations SCPI",   color: "var(--text-2)", exports: [{ name: "scpi_valorisations.csv", fn: exportScpiValuations }], importFn: importScpi },
  ];

  const confirmDeleteLabel = poches.find(p => p.key === confirmDeleteKey)?.label ?? confirmDeleteKey ?? "";

  return (
    <div>
      {importPending && (
        <ImportModal pending={importPending} onClose={() => setImportPending(null)} />
      )}

      {confirmDeleteKey && (
        <div className="overlay" onClick={() => setConfirmDeleteKey(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div className="modal-title" style={{ color: "var(--rose)" }}>Supprimer la poche</div>
            <p style={{ color: "var(--text-1)", fontSize: 13, lineHeight: 1.6, margin: "12px 0 20px" }}>
              Supprimer <strong style={{ color: "var(--text-0)" }}>"{confirmDeleteLabel}"</strong> ?<br/>
              <span style={{ color: "var(--text-2)", fontSize: 12 }}>
                Toutes les données associées (positions, ventes, dividendes, versements) seront définitivement supprimées.
              </span>
            </p>
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmDeleteKey(null)}>Annuler</button>
              <button className="btn btn-danger" onClick={deletePoche}>Supprimer</button>
            </div>
          </div>
        </div>
      )}

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

      {/* Poches d'investissement */}
      <div className="table-card" style={{ marginTop: 20 }}>
        <div className="table-head">
          <span className="table-head-title">Poches d'investissement</span>
          <button className="btn btn-primary btn-sm" onClick={startAdd}>+ Ajouter</button>
        </div>
        <div style={{ padding: "8px 0" }}>
          {poches.map(p => (
            <div key={p.key} style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:"10px 24px", borderBottom:"1px solid var(--border)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:12, height:12, borderRadius:"50%", background:p.color, flexShrink:0 }}/>
                <span style={{ fontSize:12, color:"var(--text-0)" }}>{p.label}</span>
                <span style={{ fontSize:10, color:"var(--text-2)", fontFamily:"var(--mono)" }}>{p.key}</span>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button className="btn btn-ghost btn-sm" style={{ fontSize:11 }} onClick={() => startEdit(p)}>✎</button>
                <button className="btn btn-danger btn-sm" style={{ fontSize:11 }}
                  disabled={poches.length <= 1} onClick={() => setConfirmDeleteKey(p.key)}>✕</button>
              </div>
            </div>
          ))}
        </div>
        {/* Formulaire ajout / édition */}
        {pocheFormOpen && (
          <div style={{ padding:"16px 24px", borderTop:"1px solid var(--border)", background:"var(--bg-2)" }}>
            <div style={{ fontSize:11, color:"var(--text-2)", marginBottom:10 }}>
              {editingKey === null ? "Nouvelle poche" : `Modifier "${editingKey}"`}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:8, alignItems:"end" }}>
              {editingKey === null && (
                <div className="field" style={{ margin:0 }}>
                  <label>Clé (identifiant)</label>
                  <input value={pocheForm.key} placeholder="ex: per, scpi…"
                    autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    onChange={e => setPocheForm(f => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") }))}/>
                </div>
              )}
              <div className="field" style={{ margin:0 }}>
                <label>Nom affiché</label>
                <input value={pocheForm.label} placeholder="ex: PER, SCPI…"
                  onChange={e => setPocheForm(f => ({ ...f, label: e.target.value }))}/>
              </div>
              <div className="field" style={{ margin:0 }}>
                <label>Couleur</label>
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  <input type="color" value={pocheForm.color}
                    onChange={e => setPocheForm(f => ({ ...f, color: e.target.value }))}
                    style={{ width:36, height:32, padding:2, background:"none", border:"1px solid var(--border)", borderRadius:4, cursor:"pointer" }}/>
                  <input value={pocheForm.color} placeholder="#3a7bd5"
                    onChange={e => setPocheForm(f => ({ ...f, color: e.target.value }))}
                    style={{ flex:1, fontFamily:"var(--mono)", fontSize:11 }}/>
                </div>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button className="btn btn-primary btn-sm" onClick={savePoche}
                  disabled={!pocheForm.label.trim() || (editingKey===null && !pocheForm.key.trim())}>
                  {editingKey === null ? "Ajouter" : "Sauvegarder"}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={cancelPoche}>Annuler</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* CSV export / import */}
      <div className="table-card" style={{ marginTop: 20 }}>
        <div className="table-head">
          <span className="table-head-title">Export / Import CSV</span>
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 10, minWidth: 110, opacity: exportAllState === "loading" ? 0.6 : 1,
              borderColor: exportAllState === "done" ? "var(--teal)" : exportAllState === "error" ? "var(--rose)" : undefined,
              color: exportAllState === "done" ? "var(--teal)" : exportAllState === "error" ? "var(--rose)" : undefined }}
            disabled={exportAllState === "loading"}
            title={exportAllMsg || "Exporter tous les CSV dans un dossier"}
            onClick={async () => {
              setExportAllState("loading");
              setExportAllMsg("");
              try {
                const subfolder = await invoke<string>("choose_export_folder");
                if (!subfolder) { setExportAllState("idle"); return; }
                const written = await invoke<string[]>("export_all_csv", { subfolder });
                setExportAllMsg(`${written.length} fichiers → ${subfolder}`);
                setExportAllState("done");
                setTimeout(() => { setExportAllState("idle"); setExportAllMsg(""); }, 5000);
              } catch (e) {
                setExportAllMsg(String(e));
                setExportAllState("error");
                setTimeout(() => { setExportAllState("idle"); setExportAllMsg(""); }, 4000);
              }
            }}
          >
            {exportAllState === "loading" ? "…" : exportAllState === "done" ? `✓ ${exportAllMsg.split(" fichiers")[0]} fichiers` : exportAllState === "error" ? "⚠ Erreur" : "↓ Tout exporter"}
          </button>
        </div>
        <div style={{ padding: "8px 0" }}>
          {EXPORTS.map(({ label, color, exports, importFn }) => (
            <div key={label} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 24px", borderBottom: "1px solid var(--border)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 3, height: 20, borderRadius: 2, background: color ?? "var(--text-2)", flexShrink: 0 }}/>
                <span style={{ fontSize: 12, color: "var(--text-0)" }}>{label}</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {exports.map(e => (
                  <ExportBtn key={e.name} label={e.name} onExport={e.fn}/>
                ))}
                {importFn && (
                  <ImportBtn
                    label={label}
                    onParsed={makeImportHandler(label, importFn)}
                  />
                )}
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
