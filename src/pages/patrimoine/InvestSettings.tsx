// ── InvestSettings — utilitaires CSV + modales pour la gestion des poches ────
// Ce module n'a pas de composant racine ; il exporte des fonctions et modales
// utilisées par PatrimoineInner (Patrimoine.tsx).
import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { save, open as openDialog } from "@tauri-apps/api/dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/api/fs";
import type { Poche } from "../../context/PochesContext";

// ── CSV utilities ──────────────────────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0, 10); }
function withDate(name: string) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? `${name.slice(0, dot)}_${todayStr()}${name.slice(dot)}` : `${name}_${todayStr()}`;
}
function esc(v: any): string {
  if (v == null) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers: string[], rows: any[][]) {
  return [headers.join(","), ...rows.map(r => r.map(esc).join(","))].join("\n");
}
async function downloadCsv(filename: string, content: string) {
  const path = await save({ defaultPath: filename, filters: [{ name: "CSV", extensions: ["csv"] }] });
  if (path) await writeTextFile(path, content);
}

// ── CSV parser ─────────────────────────────────────────────────────────────
export function parseCsvContent(raw: string): string[][] {
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
    row.push(cur); return row;
  });
}
function num(s: string) { return parseFloat(s) || 0; }
function str(s: string): string | null { const t = s.trim(); return t === "" ? null : t; }

// ── Converters ─────────────────────────────────────────────────────────────
function csvToPoche(rows: string[][], poche: string) {
  const data = rows.slice(1);
  return {
    positions: data.filter(r => r[0] === "Position").map(r => ({
      id: null, poche, ticker: r[3]?.trim(), nom: r[4]?.trim(),
      sous_categorie: str(r[5] ?? ""), quantite: num(r[6]),
      prix_achat: num(r[7]), date_achat: r[2]?.trim(), notes: str(r[11] ?? ""),
    })),
    ventes: data.filter(r => r[0] === "Vente").map(r => ({
      id: null, poche, ticker: r[3]?.trim(), nom: r[4]?.trim(),
      quantite: num(r[6]), prix_achat: num(r[7]), prix_vente: num(r[8]),
      date_vente: r[2]?.trim(), pnl: num(r[9]), notes: str(r[11] ?? ""),
    })),
    dividendes: data.filter(r => r[0] === "Dividende").map(r => ({
      id: null, position_id: null, ticker: r[3]?.trim(), poche,
      montant: num(r[10]), date: r[2]?.trim(), notes: str(r[11] ?? ""),
    })),
    versements: data.filter(r => r[0] === "Versement").map(r => ({
      id: null, poche, montant: num(r[10]), date: r[2]?.trim(), notes: str(r[11] ?? ""),
    })),
  };
}
function csvToScpi(rows: string[][]): any[] {
  return rows.slice(1).map(r => ({
    id: null, ticker: r[1]?.trim(), mois: r[2]?.trim(), valeur_unit: num(r[3]),
  }));
}
function csvToDepenses(rows: string[][]): { depenses: any[]; recurrentes: any[] } {
  const header = rows[0] ?? [];
  const hasType = header[0]?.trim().toLowerCase() === "type";
  const data = rows.slice(1);
  if (!hasType) {
    // ancien format sans colonne type : toutes des dépenses ordinaires
    return {
      depenses: data.map(r => ({
        id: null, date: r[1]?.trim(), categorie: r[2]?.trim(),
        sous_categorie: r[3]?.trim(), libelle: r[4]?.trim(),
        montant: num(r[5]), notes: str(r[6] ?? ""),
      })),
      recurrentes: [],
    };
  }
  const depenses: any[] = [];
  const recurrentes: any[] = [];
  data.forEach(r => {
    const type = r[0]?.trim().toLowerCase();
    if (type === "recurrente") {
      recurrentes.push({
        id: null, categorie: r[2]?.trim(), sous_categorie: r[3]?.trim(),
        libelle: r[4]?.trim(), montant: num(r[5]), notes: str(r[6] ?? ""),
        periodicite: r[7]?.trim() || "mensuel",
        date_debut: r[8]?.trim(), date_fin: str(r[9] ?? ""),
      });
    } else {
      depenses.push({
        id: null, date: r[1]?.trim(), categorie: r[2]?.trim(),
        sous_categorie: r[3]?.trim(), libelle: r[4]?.trim(),
        montant: num(r[5]), notes: str(r[6] ?? ""),
      });
    }
  });
  return { depenses, recurrentes };
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
  const header = rows[0] ?? [];
  // New format: id,poche,nom,date,montant,taux,notes
  // Old format: id,poche,date,montant,taux,notes
  const hasNom = header.length >= 7 || header[2]?.trim() === "nom";
  return rows.slice(1).map(r => {
    if (hasNom) {
      return { id: null, poche: r[1]?.trim(), nom: r[2]?.trim() ?? "", date: r[3]?.trim(), montant: num(r[4]), taux: num(r[5]), notes: str(r[6] ?? "") };
    } else {
      return { id: null, poche: r[1]?.trim(), nom: "", date: r[2]?.trim(), montant: num(r[3]), taux: num(r[4]), notes: str(r[5] ?? "") };
    }
  });
}

// ── Export / Import functions ──────────────────────────────────────────────
export async function exportPoche(poche: string, filename: string) {
  const [positions, ventes, dividendes, versements] = await Promise.all([
    invoke<any[]>("get_positions",  { poche }),
    invoke<any[]>("get_ventes",     { poche }),
    invoke<any[]>("get_dividendes", { poche }),
    invoke<any[]>("get_versements", { poche }),
  ]);
  const headers = ["type","id","date","ticker","nom","sous_categorie","quantite","prix_achat","prix_vente","pnl","montant","notes"];
  const rows = [
    ...positions.map(r  => ["Position",  r.id, r.date_achat, r.ticker, r.nom, r.sous_categorie ?? "", r.quantite, r.prix_achat, "", "", "", r.notes ?? ""]),
    ...ventes.map(r     => ["Vente",     r.id, r.date_vente, r.ticker, r.nom, "", r.quantite, r.prix_achat, r.prix_vente, r.pnl, "", r.notes ?? ""]),
    ...dividendes.map(r => ["Dividende", r.id, r.date,       r.ticker, "", "", "", "", "", "", r.montant, r.notes ?? ""]),
    ...versements.map(r => ["Versement", r.id, r.date,       "", "", "", "", "", "", "", r.montant, r.notes ?? ""]),
  ];
  downloadCsv(withDate(filename), toCsv(headers, rows));
}
export async function exportScpiValuations() {
  const rows = await invoke<any[]>("get_scpi_valuations");
  downloadCsv(withDate("scpi_valorisations.csv"), toCsv(
    ["id","ticker","mois","valeur_unit"],
    rows.map(r => [r.id, r.ticker, r.mois, r.valeur_unit])
  ));
}
export function importPoche(pocheKey: string) {
  return async (rows: string[][], replace: boolean): Promise<number> => {
    const { positions, ventes, dividendes, versements } = csvToPoche(rows, pocheKey);
    return invoke<number>("import_poche", { poche: pocheKey, positions, ventes, dividendes, versements, replace });
  };
}
export async function importScpi(rows: string[][], replace: boolean): Promise<number> {
  return invoke<number>("import_scpi_valuations", { rows: csvToScpi(rows), replace });
}
export async function exportDepenses(): Promise<void> {
  // On n'exporte que les dépenses manuelles (recurrence_id IS NULL) — les générées seront recréées à l'import
  const [depenses, recurrentes] = await Promise.all([
    invoke<any[]>("get_depenses", {}),
    invoke<any[]>("get_depenses_recurrentes"),
  ]);
  const manuelles = depenses.filter((r: any) => r.recurrence_id == null);
  const headers = ["type", "date", "categorie", "sous_categorie", "libelle", "montant", "notes", "periodicite", "date_debut", "date_fin"];
  const depRows = manuelles.map((r: any) => ["depense", r.date, r.categorie, r.sous_categorie, r.libelle, r.montant, r.notes ?? "", "", "", ""]);
  const recRows = recurrentes.map((r: any) => ["recurrente", "", r.categorie, r.sous_categorie, r.libelle, r.montant, r.notes ?? "", r.periodicite, r.date_debut, r.date_fin ?? ""]);
  downloadCsv(withDate("depenses.csv"), toCsv(headers, [...depRows, ...recRows]));
}
export async function exportSalaires(): Promise<void> {
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
export async function exportLivrets(): Promise<void> {
  const rows = await invoke<any[]>("get_livrets");
  downloadCsv(withDate("livrets.csv"), toCsv(
    ["id", "poche", "nom", "date", "montant", "taux", "notes"],
    rows.map(r => [r.id, r.poche, r.nom ?? "", r.date, r.montant, r.taux, r.notes])
  ));
}
export async function importDepenses(rows: string[][], replace: boolean): Promise<number> {
  const { depenses, recurrentes } = csvToDepenses(rows);
  const [n1, n2] = await Promise.all([
    invoke<number>("import_depenses", { rows: depenses, replace }),
    invoke<number>("import_depenses_recurrentes", { rows: recurrentes, replace }),
  ]);
  // Régénérer les dépenses récurrentes après import
  await invoke("process_depenses_recurrentes");
  return n1 + n2;
}
export async function importSalaires(rows: string[][], replace: boolean): Promise<number> {
  return invoke<number>("import_salaires", { rows: csvToSalaires(rows), replace });
}
// ── Per-livret poche export / import ──────────────────────────────────────────
export async function exportLivretPoche(type_livret: string, nom: string): Promise<void> {
  const all = await invoke<any[]>("get_livrets");
  const rows = all.filter((r: any) => r.poche === type_livret && r.nom === nom);
  const isInteret = (r: any) => (r.notes ?? "").startsWith("[INTERET");
  const isRetrait = (r: any) => !isInteret(r) && r.montant < 0;
  downloadCsv(withDate(`${nom.replace(/[^a-z0-9]/gi, "_")}.csv`), toCsv(
    ["id", "date", "type", "montant", "notes"],
    rows.map(r => [
      r.id, r.date,
      isInteret(r) ? "interet" : isRetrait(r) ? "retrait" : "versement",
      Math.abs(r.montant), r.notes ?? "",
    ])
  ));
}
function csvToLivretOps(rows: string[][]): any[] {
  return rows.slice(1).map(r => {
    const type = r[2]?.trim().toLowerCase();
    const montantAbs = parseFloat(r[3]) || 0;
    const montant = type === "retrait" ? -montantAbs : montantAbs;
    const notes = r[4]?.trim() || null;
    return { poche: "", nom: "", montant, taux: 0, date: r[1]?.trim(), notes };
  });
}
export function importLivretOps(type_livret: string, nom: string) {
  return async (rows: string[][], replace: boolean): Promise<number> => {
    const ops = csvToLivretOps(rows);
    return invoke<number>("import_livret_ops", { typeLivret: type_livret, nom, rows: ops, replace });
  };
}

export async function importLivrets(rows: string[][], replace: boolean): Promise<number> {
  return invoke<number>("import_livrets", { rows: csvToLivrets(rows), replace });
}

export async function exportInvestPoches(pocheKeys: string[]): Promise<void> {
  await invoke("export_invest_csv", { poches: pocheKeys });
}
export async function exportLivretsBatch(livretPoches: { type_livret: string; nom: string }[]): Promise<void> {
  await invoke("export_livrets_batch", { livretPoches });
}

// ── Paris Sportifs export / import ────────────────────────────────────────────
// CSV format: type,date,freebet,mise,cote,gain,statut,notes,categorie,resultat
// "pari" rows: type=pari, date/freebet/mise/cote/gain/statut/notes filled, categorie/resultat empty
// "selection" rows: type=selection, only categorie+resultat filled, belong to the last pari row

export async function exportParisPoche(poche: string): Promise<void> {
  const paris = await invoke<any[]>("get_paris", { poche, mois: null });
  const headers = ["type", "date", "freebet", "mise", "cote", "gain", "statut", "notes", "categorie", "resultat"];
  const rows: any[][] = [];
  for (const p of paris) {
    rows.push(["pari", p.date, p.freebet ? "1" : "0", p.mise ?? "", p.cote, p.gain ?? "", p.statut, p.notes ?? "", "", ""]);
    for (const s of (p.selections ?? [])) {
      rows.push(["selection", "", "", "", "", "", "", "", s.categorie, s.resultat]);
    }
  }
  const safeName = poche.replace(/[^a-z0-9]/gi, "_");
  downloadCsv(withDate(`paris_${safeName}.csv`), toCsv(headers, rows));
}

export function importParisPoche(poche: string) {
  return async (rows: string[][], replace: boolean): Promise<number> => {
    const paris: any[] = [];
    let currentPari: any | null = null;
    for (const row of rows.slice(1)) {
      const type = row[0]?.trim().toLowerCase();
      if (type === "pari") {
        if (currentPari) paris.push(currentPari);
        currentPari = {
          id: null,
          poche,
          date: row[1]?.trim() ?? "",
          freebet: row[2]?.trim() === "1",
          mise: row[3]?.trim() ? parseFloat(row[3]) : null,
          cote: parseFloat(row[4]) || 1.0,
          gain: row[5]?.trim() ? parseFloat(row[5]) : null,
          statut: row[6]?.trim() || "en_cours",
          notes: row[7]?.trim() || null,
          selections: [],
        };
      } else if (type === "selection" && currentPari) {
        currentPari.selections.push({
          id: null,
          pari_id: null,
          categorie: row[8]?.trim() ?? "",
          resultat: row[9]?.trim() || "en_cours",
        });
      }
    }
    if (currentPari) paris.push(currentPari);
    return invoke<number>("import_paris", { poche, paris, replace });
  };
}

// ── Types ──────────────────────────────────────────────────────────────────
export type ImportPending = {
  label: string;
  rowCount: number;
  onConfirm: (replace: boolean) => Promise<void>;
};

// ── ImportModal ────────────────────────────────────────────────────────────
export function ImportModal({ pending, onClose }: { pending: ImportPending; onClose: () => void }) {
  const [state, setState] = useState<"idle"|"loading">("idle");
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
export function ImportBtn({ label, onParsed }: {
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
      style={{ fontSize:10, color:"var(--text-2)" }} onClick={handle} title={`Importer ${label}`}>
      ↑ Import
    </button>
  );
}

// ── ExportBtn ──────────────────────────────────────────────────────────────
export function ExportBtn({ label, onExport }: { label: string; onExport: () => Promise<void> }) {
  const [state, setState] = useState<"idle"|"loading"|"done">("idle");
  const handle = async () => {
    setState("loading");
    try { await onExport(); setState("done"); setTimeout(() => setState("idle"), 2000); }
    catch { setState("idle"); }
  };
  return (
    <button className="btn btn-ghost btn-sm"
      style={{ fontSize:10, opacity: state === "loading" ? 0.6 : 1 }}
      disabled={state === "loading"} onClick={handle} title={`Exporter ${label}`}>
      {state === "loading" ? "…" : state === "done" ? "✓" : "↓ Export"}
    </button>
  );
}

// ── PocheFormModal ─────────────────────────────────────────────────────────
export function PocheFormModal({
  editingKey, initial, onSave, onClose,
}: {
  editingKey: string | null;  // null = ajout
  initial: Poche;
  onSave: (p: Poche) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Poche>({ ...initial });
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-title">
          {editingKey === null ? "Nouvelle poche" : `Modifier "${editingKey}"`}
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:12, marginTop:16 }}>
          {editingKey === null && (
            <div className="field" style={{ margin:0 }}>
              <label>Clé (identifiant)</label>
              <input value={form.key} placeholder="ex: per, scpi…"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                style={{ width:"100%", boxSizing:"border-box" }}
                onChange={e => setForm(f => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") }))}/>
            </div>
          )}
          <div className="field" style={{ margin:0 }}>
            <label>Nom affiché</label>
            <input value={form.label} placeholder="ex: PER, SCPI…"
              style={{ width:"100%", boxSizing:"border-box" }}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}/>
          </div>
          <div className="field" style={{ margin:0 }}>
            <label>Couleur</label>
            <div style={{ display:"flex", gap:6, alignItems:"center", minWidth:0 }}>
              <input type="color" value={form.color}
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                style={{ width:36, height:32, flexShrink:0, padding:2, background:"none", border:"1px solid var(--border)", borderRadius:4, cursor:"pointer" }}/>
              <input value={form.color} placeholder="#3a7bd5"
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                style={{ flex:1, minWidth:0, fontFamily:"var(--mono)", fontSize:11, boxSizing:"border-box" }}/>
            </div>
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary"
            disabled={!form.label.trim() || (editingKey === null && !form.key.trim())}
            onClick={() => onSave(form)}>
            {editingKey === null ? "Ajouter" : "Sauvegarder"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ConfirmDeleteModal ─────────────────────────────────────────────────────
export function ConfirmDeleteModal({ label, onConfirm, onClose }: {
  label: string; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="modal-title" style={{ color:"var(--rose)" }}>Supprimer la poche</div>
        <p style={{ color:"var(--text-1)", fontSize:13, lineHeight:1.6, margin:"12px 0 20px" }}>
          Supprimer <strong style={{ color:"var(--text-0)" }}>"{label}"</strong> ?<br/>
          <span style={{ color:"var(--text-2)", fontSize:12 }}>
            Toutes les données associées (positions, ventes, dividendes, versements) seront définitivement supprimées.
          </span>
        </p>
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-danger" onClick={onConfirm}>Supprimer</button>
        </div>
      </div>
    </div>
  );
}
