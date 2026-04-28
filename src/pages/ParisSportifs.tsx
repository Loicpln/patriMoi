import { useEffect, useMemo, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  ResponsiveContainer, ComposedChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ReferenceLine,
} from "recharts";
import DatePicker from "../components/DatePicker";
import NumInput from "../components/NumInput";
import MonthSelector from "../components/MonthSelector";
import { defaultDateForMonth } from "../constants";
import { ChartGrid, NestedPie } from "./patrimoine/shared";
import {
  ExportBtn, ImportBtn, ImportModal, ImportPending,
  exportParisPoche, importParisPoche,
} from "./patrimoine/InvestSettings";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ParisPoche {
  id?: number;
  nom: string;
  couleur: string;
}

interface ParisSelection {
  id?: number;
  pari_id?: number;
  categorie: string;
  resultat: string;
}

interface Pari {
  id?: number;
  poche: string;
  date: string;
  freebet: boolean;
  mise?: number;
  cote: number;
  gain?: number;
  statut: string;
  notes?: string;
  selections?: ParisSelection[];
}

// ── Constants ─────────────────────────────────────────────────────────────────
const PRESET_COLORS = [
  "#3a7bd5", "#e84393", "#f5a623", "#7ed321", "#9b59b6", "#1abc9c", "#e74c3c",
];

const STATUT_LABELS: Record<string, string> = {
  en_cours: "En cours",
  gagne: "Gagné",
  perdu: "Perdu",
  annule: "Annulé",
  cashout: "Cashout",
};

const STATUT_COLORS: Record<string, string> = {
  en_cours: "var(--gold)",
  gagne: "var(--teal)",
  perdu: "var(--rose)",
  annule: "var(--text-2)",
  cashout: "#9b59b6",
};

const RESULTAT_LABELS: Record<string, string> = {
  en_cours: "En cours",
  gagne: "Gagné",
  perdu: "Perdu",
  annule: "Annulé",
  cashout: "Cashout",
};

function curMonth() {
  return new Date().toISOString().slice(0, 7);
}

function fmt2(n: number) {
  return n.toFixed(2) + " €";
}

// ── Balance calculation ────────────────────────────────────────────────────────
const SETTLED = ["gagne", "perdu", "cashout"];

function calcSolde(paris: Pari[]) {
  let gain = 0;
  let mise = 0;
  for (const p of paris) {
    if ((p.statut === "gagne" || p.statut === "cashout") && p.gain != null) gain += p.gain;
    if (!p.freebet && p.mise != null && SETTLED.includes(p.statut)) mise += p.mise;
  }
  return gain - mise;
}

function calcMise(paris: Pari[]) {
  return paris.filter(p => !p.freebet && p.mise != null && SETTLED.includes(p.statut))
    .reduce((s, p) => s + (p.mise ?? 0), 0);
}

function calcGain(paris: Pari[]) {
  return paris.filter(p => (p.statut === "gagne" || p.statut === "cashout") && p.gain != null)
    .reduce((s, p) => s + (p.gain ?? 0), 0);
}

// Un pari est "totalement gagné" si statut=gagne ET toutes ses sélections sont gagne (ou annule)
function isFullyWon(p: Pari): boolean {
  if (p.statut !== "gagne") return false;
  if (!p.selections || p.selections.length === 0) return true;
  return p.selections.every(s => s.resultat === "gagne" || s.resultat === "annule");
}

const CAT_COLORS = [
  "#3a7bd5","#f5a623","#7ed321","#e84393","#9b59b6",
  "#1abc9c","#e74c3c","#3498db","#e67e22","#2ecc71",
];

const MN_SHORT = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

// ── Poche Form Modal ──────────────────────────────────────────────────────────
function PocheModal({
  initial, title, onSave, onClose,
}: {
  initial: ParisPoche; title: string;
  onSave: (p: ParisPoche) => Promise<void>; onClose: () => void;
}) {
  const [form, setForm] = useState<ParisPoche>({ ...initial });

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="modal-title">{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Nom de la poche</label>
            <input
              value={form.nom}
              placeholder="ex: Winamax, Betclic…"
              style={{ width: "100%", boxSizing: "border-box" }}
              onChange={e => setForm(f => ({ ...f, nom: e.target.value }))}
            />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Couleur</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setForm(f => ({ ...f, couleur: c }))}
                  style={{
                    width: 28, height: 28, borderRadius: "50%", background: c,
                    border: form.couleur === c ? "3px solid var(--text-0)" : "2px solid transparent",
                    cursor: "pointer", flexShrink: 0,
                  }}
                />
              ))}
              <input
                type="color"
                value={form.couleur || "#3a7bd5"}
                onChange={e => setForm(f => ({ ...f, couleur: e.target.value }))}
                style={{ width: 32, height: 28, padding: 2, background: "none", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
              />
            </div>
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button
            className="btn btn-primary"
            disabled={!form.nom.trim()}
            onClick={() => onSave(form).then(onClose)}
          >
            Sauvegarder
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Pari Form Modal ───────────────────────────────────────────────────────────
function PariModal({
  initial, title, knownCats, onSave, onClose,
}: {
  initial: Pari; title: string; knownCats: string[];
  onSave: (p: Pari) => Promise<void>; onClose: () => void;
}) {
  const [form, setForm] = useState<Pari>({ ...initial, selections: initial.selections ?? [] });

  const addSel = () => setForm(f => ({
    ...f,
    selections: [...(f.selections ?? []), { categorie: "", resultat: "en_cours" }],
  }));

  const removeSel = (i: number) => setForm(f => ({
    ...f,
    selections: (f.selections ?? []).filter((_, idx) => idx !== i),
  }));

  const setSel = (i: number, key: keyof ParisSelection, val: string) => setForm(f => ({
    ...f,
    selections: (f.selections ?? []).map((s, idx) => idx === i ? { ...s, [key]: val } : s),
  }));

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 560, width: "100%", maxHeight: "90vh", overflowY: "auto", boxSizing: "border-box" }}
      >
        <div className="modal-title">{title}</div>

        {/* Row 1: Date + Freebet */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "12px 16px", marginTop: 16 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Date</label>
            <DatePicker value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} />
          </div>
          <div className="field" style={{ margin: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}>
              <input
                type="checkbox"
                checked={form.freebet}
                onChange={e => setForm(f => ({ ...f, freebet: e.target.checked, mise: e.target.checked ? undefined : f.mise }))}
              />
              Freebet
            </label>
          </div>
        </div>

        {/* Row 2: Mise / Cote / Gain */}
        <div style={{ display: "grid", gridTemplateColumns: form.freebet ? "1fr 1fr" : "1fr 1fr 1fr", gap: "12px 16px", marginTop: 12, minWidth: 0 }}>
          {!form.freebet && (
            <div className="field" style={{ margin: 0, minWidth: 0 }}>
              <label>Mise (€)</label>
              <NumInput value={form.mise ?? 0} onChange={v => setForm(f => ({ ...f, mise: v || undefined }))} style={{ width: "100%", boxSizing: "border-box" }} />
            </div>
          )}
          <div className="field" style={{ margin: 0, minWidth: 0 }}>
            <label>Cote</label>
            <NumInput value={form.cote} onChange={v => setForm(f => ({ ...f, cote: v }))} style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
          <div className="field" style={{ margin: 0, minWidth: 0 }}>
            <label>Gain (€)</label>
            <NumInput value={form.gain ?? 0} onChange={v => setForm(f => ({ ...f, gain: v || undefined }))} style={{ width: "100%", boxSizing: "border-box" }} />
          </div>
        </div>

        {/* Row 3: Statut */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px 16px", marginTop: 12 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Statut</label>
            <select value={form.statut} onChange={e => setForm(f => ({ ...f, statut: e.target.value }))}>
              <option value="en_cours">En cours</option>
              <option value="gagne">Gagné</option>
              <option value="perdu">Perdu</option>
              <option value="cashout">Cashout</option>
              <option value="annule">Annulé</option>
            </select>
          </div>
        </div>

        {/* Row 4: Notes */}
        <div className="field" style={{ margin: "12px 0 0" }}>
          <label>Notes</label>
          <textarea
            rows={2}
            value={form.notes ?? ""}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value || undefined }))}
          />
        </div>

        {/* Selections */}
        <datalist id="sel-cats-list">
          {knownCats.map((c, i) => <option key={i} value={c} />)}
        </datalist>
        <div style={{ marginTop: 20, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>Sélections</span>
            <button className="btn btn-ghost btn-sm" onClick={addSel}>+ Ajouter</button>
          </div>
          {(form.selections ?? []).length === 0 && (
            <div style={{ color: "var(--text-2)", fontSize: 11, fontStyle: "italic" }}>Aucune sélection</div>
          )}
          {(form.selections ?? []).map((s, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <input
                list="sel-cats-list"
                value={s.categorie}
                placeholder={`Sélection ${i + 1} (ex: PSG - Victoire)`}
                onChange={e => setSel(i, "categorie", e.target.value)}
                style={{
                  width: "100%", boxSizing: "border-box", height: 34,
                  background: "var(--bg-0)", border: "1px solid var(--border-l)",
                  borderRadius: 6, padding: "0 11px",
                  color: "var(--text-0)", fontFamily: "var(--mono)", fontSize: 12, outline: "none",
                }}
              />
              <select
                value={s.resultat}
                onChange={e => setSel(i, "resultat", e.target.value)}
                style={{
                  minWidth: 100, boxSizing: "border-box", height: 34,
                  background: "var(--bg-0)", border: "1px solid var(--border-l)",
                  borderRadius: 6, padding: "0 11px",
                  color: "var(--text-0)", fontFamily: "var(--mono)", fontSize: 12, outline: "none",
                }}
              >
                <option value="en_cours">En cours</option>
                <option value="gagne">Gagné</option>
                <option value="perdu">Perdu</option>
                <option value="cashout">Cashout</option>
                <option value="annule">Annulé</option>
              </select>
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: "var(--rose)", padding: "4px 8px" }}
                onClick={() => removeSel(i)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="form-actions">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button
            className="btn btn-primary"
            onClick={() => onSave(form).then(onClose)}
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Confirm Delete Modal ──────────────────────────────────────────────────────
function ConfirmModal({ label, onConfirm, onClose }: {
  label: string; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="modal-title" style={{ color: "var(--rose)" }}>Confirmer la suppression</div>
        <p style={{ color: "var(--text-1)", fontSize: 13, lineHeight: 1.6, margin: "12px 0 20px" }}>
          Supprimer <strong style={{ color: "var(--text-0)" }}>"{label}"</strong> ?<br />
          <span style={{ color: "var(--text-2)", fontSize: 12 }}>
            Cette action est irréversible.
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

// ── Statut Badge ──────────────────────────────────────────────────────────────
function StatutBadge({ statut }: { statut: string }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 10,
      fontSize: 10,
      fontWeight: 600,
      color: STATUT_COLORS[statut] ?? "var(--text-2)",
      border: `1px solid ${STATUT_COLORS[statut] ?? "var(--text-2)"}`,
      background: (STATUT_COLORS[statut] ?? "var(--text-2)") + "22",
    }}>
      {STATUT_LABELS[statut] ?? statut}
    </span>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ParisSportifs() {
  const [poches, setPoches] = useState<ParisPoche[]>([]);
  const [selectedPocheId, setSelectedPocheId] = useState<number | null>(null);
  const [allData, setAllData] = useState<Pari[]>([]);          // all paris, all poches, all time
  const [mois, setMois] = useState(curMonth());
  const [firstMonth, setFirstMonth] = useState<string | undefined>(undefined);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [openPoches, setOpenPoches] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"bookmakers" | "graphiques">("graphiques");

  // Modals
  const [pocheModal, setPocheModal] = useState<null | "add" | ParisPoche>(null);
  const [pariModal, setPariModal] = useState<null | Pari>(null);
  const [confirmDelete, setConfirmDelete] = useState<null | { label: string; onConfirm: () => void }>(null);
  const [importPending, setImportPending] = useState<ImportPending | null>(null);

  // Editing
  const [editingPoche, setEditingPoche] = useState<ParisPoche | null>(null);

  const selectedPoche = useMemo(
    () => poches.find(p => p.id === selectedPocheId) ?? null,
    [poches, selectedPocheId]
  );

  // ── Load functions ───────────────────────────────────────────────────────
  const loadPoches = useCallback(async () => {
    try {
      const ps = await invoke<ParisPoche[]>("get_paris_poches");
      setPoches(ps);
      setSelectedPocheId(prev => {
        if (prev != null && ps.some(p => p.id === prev)) return prev;
        return ps[0]?.id ?? null;
      });
    } catch {}
  }, []);

  const loadData = useCallback(async () => {
    try {
      const data = await invoke<Pari[]>("get_paris", { poche: null, mois: null });
      setAllData(data);
      const dates = data.map(p => p.date.slice(0, 7)).sort();
      setFirstMonth(dates[0] ?? curMonth());
    } catch { setAllData([]); setFirstMonth(curMonth()); }
  }, []);

  useEffect(() => { loadPoches(); loadData(); }, [loadPoches, loadData]);

  const reload = useCallback(() => { loadData(); }, [loadData]);

  // ── Derived data ─────────────────────────────────────────────────────────
  // Per-poche all-time (for graphiques view + poche cards)
  const allParis = useMemo(() =>
    selectedPoche ? allData.filter(p => p.poche === selectedPoche.nom) : [],
  [allData, selectedPoche]);

  // Per-poche current month (for graphiques stats)
  const moisParis = useMemo(() =>
    allParis.filter(p => p.date.slice(0, 7) === mois),
  [allParis, mois]);

  // All poches × current month (for bookmakers view)
  const moisParisPerPoche = useMemo(() => {
    const map: Record<string, Pari[]> = {};
    for (const p of poches) map[p.nom] = [];
    for (const p of allData) {
      if (p.date.slice(0, 7) === mois && map[p.poche]) map[p.poche].push(p);
    }
    return map;
  }, [allData, mois, poches]);

  // All-time per poche (for bookmakers solde)
  const allParisPerPoche = useMemo(() => {
    const map: Record<string, Pari[]> = {};
    for (const p of poches) map[p.nom] = [];
    for (const p of allData) { if (map[p.poche]) map[p.poche].push(p); }
    return map;
  }, [allData, poches]);

  // ── Stats (graphiques view) ───────────────────────────────────────────────
  const allTimeSolde = useMemo(() => calcSolde(allParis), [allParis]);
  const allTimeMise  = useMemo(() => calcMise(allParis),  [allParis]);
  const allTimeGain  = useMemo(() => calcGain(allParis),  [allParis]);

  const moisSolde = useMemo(() => calcSolde(moisParis), [moisParis]);
  const moisMise  = useMemo(() => calcMise(moisParis),  [moisParis]);
  const moisGain  = useMemo(() => calcGain(moisParis),  [moisParis]);
  const moisROI   = useMemo(() => moisMise > 0 ? ((moisGain - moisMise) / moisMise * 100) : 0, [moisGain, moisMise]);

  const tauxReussite = useMemo(() => {
    const settled = moisParis.filter(p => p.statut === "gagne" || p.statut === "perdu");
    if (settled.length === 0) return null;
    const won = settled.filter(isFullyWon).length;
    return { rate: (won / settled.length) * 100, won, total: settled.length };
  }, [moisParis]);

  // Catégories pie — all-time pour poche sélectionnée
  const catPieData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of allParis) {
      if (!p.selections || p.selections.length === 0) {
        map["Autre"] = (map["Autre"] ?? 0) + 1;
      } else {
        for (const s of p.selections) {
          const raw = s.categorie.trim() || "Autre";
          const sport = raw.split(/\s*[-–—]\s*/)[0].trim() || raw;
          map[sport] = (map[sport] ?? 0) + 1;
        }
      }
    }
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [allParis]);

  // Solde cumulé all-time pour poche sélectionnée
  const soldeEvoData = useMemo(() => {
    const settled = [...allParis]
      .filter(p => p.statut === "gagne" || p.statut === "perdu")
      .sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? 0) - (b.id ?? 0));
    let cumul = 0;
    return settled.map(p => {
      if (p.statut === "gagne" && p.gain != null) cumul += p.gain;
      if (!p.freebet && p.mise != null && p.statut !== "annule") cumul -= p.mise;
      return { date: p.date, solde: Math.round(cumul * 100) / 100 };
    });
  }, [allParis]);

  const lastSolde = soldeEvoData.length > 0 ? soldeEvoData[soldeEvoData.length - 1].solde : 0;
  const soldeColor = lastSolde >= 0 ? "var(--teal)" : "var(--rose)";

  // X-axis: first date of each month (≤ 8 labels)
  const soldeXTicks = useMemo(() => {
    const seen = new Set<string>();
    const firsts: string[] = [];
    soldeEvoData.forEach(d => {
      const m = d.date.slice(0, 7);
      if (!seen.has(m)) { seen.add(m); firsts.push(d.date); }
    });
    const step = Math.max(1, Math.ceil(firsts.length / 8));
    return firsts.filter((_, i) => i % step === 0);
  }, [soldeEvoData]);

  // Stats globales toutes poches (pour vue bookmakers)
  const allMoisParis   = useMemo(() => allData.filter(p => p.date.slice(0, 7) === mois), [allData, mois]);
  const globalMoisMise = useMemo(() => calcMise(allMoisParis), [allMoisParis]);
  const globalMoisGain = useMemo(() => calcGain(allMoisParis), [allMoisParis]);
  const globalMoisSolde= useMemo(() => calcSolde(allMoisParis),[allMoisParis]);
  const globalMoisROI  = useMemo(() => globalMoisMise > 0 ? ((globalMoisGain - globalMoisMise) / globalMoisMise * 100) : 0, [globalMoisGain, globalMoisMise]);
  const globalAllSolde = useMemo(() => calcSolde(allData), [allData]);
  const globalTaux     = useMemo(() => {
    const settled = allMoisParis.filter(p => p.statut === "gagne" || p.statut === "perdu");
    if (!settled.length) return null;
    const won = settled.filter(isFullyWon).length;
    return { rate: (won / settled.length) * 100, won, total: settled.length };
  }, [allMoisParis]);

  // Catégories connues (autocomplétion des sélections) — toutes les catégories déjà saisies
  const knownCats = useMemo(() => {
    const set = new Set<string>();
    for (const p of allData) {
      for (const s of p.selections ?? []) {
        const c = s.categorie.trim();
        if (c) set.add(c);
      }
    }
    return [...set].sort();
  }, [allData]);

  // Chart nodes
  const catPieNode = (h: number) => {
    if (catPieData.length === 0) return <div className="empty">Aucune donnée.</div>;
    const total = catPieData.reduce((s, d) => s + d.value, 0);
    const inner = catPieData.map((d, i) => ({ name: d.name, value: d.value, color: CAT_COLORS[i % CAT_COLORS.length] }));
    const outer = inner.map(d => ({ ...d, group: d.name }));
    return <NestedPie inner={inner} outer={outer} total={total} fmt={n => `${Math.round(n)}`} h={h} />;
  };

  const soldeNode = (h: number) => {
    if (soldeEvoData.length === 0) return <div className="empty">Aucun pari résolu.</div>;
    return (
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={soldeEvoData} margin={{ left: 0, right: 10, top: 5, bottom: 0 }}>
          <defs>
            <linearGradient id="soldeGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={soldeColor} stopOpacity={0.35} />
              <stop offset="95%" stopColor={soldeColor} stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" ticks={soldeXTicks} tick={{ fontSize: 8, fontFamily: "var(--mono)" }}
            tickFormatter={d => MN_SHORT[parseInt(d.slice(5, 7)) - 1] + " " + d.slice(2, 4)} />
          <YAxis tick={{ fontSize: 8, fontFamily: "var(--mono)" }}
            tickFormatter={v => `${v}€`} width={46} />
          <RTooltip
            contentStyle={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11 }}
            formatter={(v: any) => [fmt2(Number(v)), "Solde cumulé"]}
          />
          <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
          <Area type="monotone" dataKey="solde" stroke={soldeColor} strokeWidth={2}
            fill="url(#soldeGrad)" dot={false} activeDot={{ r: 3, fill: soldeColor }} />
        </ComposedChart>
      </ResponsiveContainer>
    );
  };

  // ── Poche actions ────────────────────────────────────────────────────────
  const savePoche = async (p: ParisPoche) => {
    if (editingPoche?.id != null) {
      await invoke("update_paris_poche", { id: editingPoche.id, nom: p.nom, couleur: p.couleur });
    } else {
      await invoke("add_paris_poche", { poche: p });
    }
    setEditingPoche(null);
    setPocheModal(null);
    await loadPoches();
  };

  const deletePoche = async (id: number) => {
    await invoke("delete_paris_poche", { id });
    await loadPoches();
    await loadData();
  };

  // ── Pari actions ─────────────────────────────────────────────────────────
  const savePari = async (p: Pari) => {
    if (p.id != null) await invoke("update_pari", { pari: p });
    else              await invoke("add_pari",    { pari: p });
    reload();
  };

  const deletePariAction = async (id: number) => {
    await invoke("delete_pari", { id });
    reload();
  };

  const toggleRow = (id: number) => setExpandedRows(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });
  const toggleOpenPoche = (nom: string) => setOpenPoches(prev => {
    const s = new Set(prev); s.has(nom) ? s.delete(nom) : s.add(nom); return s;
  });

  // ── Paris table (reused in both views) ───────────────────────────────────
  const PariTable = ({ paris, pocheName }: { paris: Pari[]; pocheName: string }) => (
    paris.length === 0 ? <div className="empty">Aucun pari ce mois.</div> : (
      <table>
        <thead>
          <tr>
            <th style={{ width: 16 }}/>
            <th>Date</th><th>Sélections</th>
            <th style={{ textAlign: "right" }}>Cote</th>
            <th style={{ textAlign: "right" }}>Mise</th>
            <th style={{ textAlign: "right" }}>Gain</th>
            <th>Statut</th><th style={{ width: 64 }}/>
          </tr>
        </thead>
        <tbody>
          {paris.map(p => {
            const expanded = p.id != null && expandedRows.has(p.id);
            const selCount = p.selections?.length ?? 0;
            return (
              <>
                <tr key={p.id} style={{ cursor: selCount > 0 ? "pointer" : "default" }}
                  onClick={() => selCount > 0 && p.id != null && toggleRow(p.id)}>
                  <td style={{ textAlign: "center", color: "var(--text-2)", fontSize: 10 }}>
                    {selCount > 0 ? (expanded ? "▼" : "▶") : ""}
                  </td>
                  <td style={{ color: "var(--text-1)", fontFamily: "var(--mono)", fontSize: 12 }}>{p.date}</td>
                  <td>
                    <span style={{ color: "var(--text-0)", fontSize: 12 }}>
                      {selCount > 0
                        ? (() => {
                            const counts = new Map<string, number>();
                            p.selections!.map(s => s.categorie).filter(Boolean)
                              .forEach(c => counts.set(c, (counts.get(c) ?? 0) + 1));
                            return [...counts.entries()]
                              .map(([c, n]) => n > 1 ? `${n}×${c}` : c)
                              .join(" + ") || `${selCount} sél.`;
                          })()
                        : <span style={{ color: "var(--text-2)", fontStyle: "italic" }}>—</span>}
                    </span>
                    {p.freebet && <span style={{ marginLeft: 6, fontSize: 9, color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: 3, padding: "1px 4px" }}>FB</span>}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12 }}>{p.cote.toFixed(2)}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-1)" }}>
                    {p.freebet ? <span style={{ fontSize: 10, color: "var(--gold)" }}>FB</span> : p.mise != null ? fmt2(p.mise) : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12, color: p.gain != null ? "var(--teal)" : "var(--text-2)" }}>
                    {p.gain != null ? fmt2(p.gain) : "—"}
                  </td>
                  <td><StatutBadge statut={p.statut} /></td>
                  <td><div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
                    <button className="btn btn-ghost btn-sm" style={{ padding: "3px 7px" }} onClick={() => setPariModal(p)}>✎</button>
                    <button className="btn btn-ghost btn-sm" style={{ padding: "3px 7px", color: "var(--rose)" }}
                      onClick={() => setConfirmDelete({ label: `pari du ${p.date}`, onConfirm: () => deletePariAction(p.id!) })}>✕</button>
                  </div></td>
                </tr>
                {expanded && p.selections && p.selections.length > 0 && (
                  <tr key={`${p.id}-exp`} style={{ background: "var(--bg-2)" }}>
                    <td colSpan={8} style={{ padding: "8px 24px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {p.selections.map((s, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
                            <span style={{ color: "var(--text-2)", fontFamily: "var(--mono)", minWidth: 20 }}>{i + 1}.</span>
                            <span style={{ color: "var(--text-0)", flex: 1 }}>{s.categorie || <em style={{ color: "var(--text-2)" }}>Sans titre</em>}</span>
                            <span style={{ fontSize: 10, color: STATUT_COLORS[s.resultat] ?? "var(--text-2)",
                              border: `1px solid ${STATUT_COLORS[s.resultat] ?? "var(--text-2)"}`,
                              borderRadius: 8, padding: "1px 7px",
                              background: (STATUT_COLORS[s.resultat] ?? "var(--text-2)") + "22" }}>
                              {RESULTAT_LABELS[s.resultat] ?? s.resultat}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    )
  );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Modals */}
      {importPending && <ImportModal pending={importPending} onClose={() => setImportPending(null)} />}
      {pocheModal && (
        <PocheModal
          title={editingPoche ? `Modifier "${editingPoche.nom}"` : "Nouvelle poche"}
          initial={editingPoche ?? { nom: "", couleur: PRESET_COLORS[0] }}
          onSave={savePoche}
          onClose={() => { setPocheModal(null); setEditingPoche(null); }}
        />
      )}
      {pariModal && (
        <PariModal
          title={pariModal.id != null ? "Modifier le pari" : "Ajouter un pari"}
          initial={pariModal}
          knownCats={knownCats}
          onSave={savePari}
          onClose={() => setPariModal(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmModal label={confirmDelete.label}
          onConfirm={() => { confirmDelete.onConfirm(); setConfirmDelete(null); }}
          onClose={() => setConfirmDelete(null)} />
      )}

      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title">Paris Sportifs</h1>
        <p className="page-sub">Suivi par bookmaker · {mois}</p>
      </div>

      <MonthSelector value={mois} onChange={setMois} firstMonth={firstMonth} />

      {/* Action bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 16, gap: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => { setEditingPoche(null); setPocheModal("add"); }}>+ Poche</button>
        <button
          className={`btn btn-sm ${viewMode === "bookmakers" ? "btn-primary" : "btn-ghost"}`}
          style={{ whiteSpace: "nowrap" }}
          onClick={() => setViewMode(v => v === "bookmakers" ? "graphiques" : "bookmakers")}>
          {viewMode === "bookmakers" ? "Graphiques" : "Bookmakers"}
        </button>
      </div>

      {poches.length === 0 && (
        <div className="empty" style={{ marginBottom: 24 }}>Aucune poche. Cliquez sur <strong>+ Poche</strong> pour commencer.</div>
      )}

      {/* ── Stats globales — communes aux deux vues ── */}
      {poches.length > 0 && (
        <div className="stat-row" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="sc-label">Solde global tout temps</div>
            <div className="sc-value" style={{ color: globalAllSolde >= 0 ? "var(--teal)" : "var(--rose)" }}>{fmt2(globalAllSolde)}</div>
          </div>
          <div className="stat-card">
            <div className="sc-label">Misé · {mois}</div>
            <div className="sc-value">{fmt2(globalMoisMise)}</div>
          </div>
          <div className="stat-card">
            <div className="sc-label">Gagné · {mois}</div>
            <div className="sc-value" style={{ color: "var(--teal)" }}>{fmt2(globalMoisGain)}</div>
          </div>
          <div className="stat-card">
            <div className="sc-label">Solde · {mois}</div>
            <div className="sc-value" style={{ color: globalMoisSolde >= 0 ? "var(--teal)" : "var(--rose)" }}>{fmt2(globalMoisSolde)}</div>
          </div>
          <div className="stat-card">
            <div className="sc-label">ROI · {mois}</div>
            <div className="sc-value" style={{ color: globalMoisROI >= 0 ? "var(--teal)" : "var(--rose)" }}>
              {globalMoisMise > 0 ? `${globalMoisROI >= 0 ? "+" : ""}${globalMoisROI.toFixed(1)} %` : "—"}
            </div>
          </div>
          <div className="stat-card">
            <div className="sc-label">Taux de réussite</div>
            <div className="sc-value" style={{ color: globalTaux == null ? "var(--text-2)" : globalTaux.rate >= 50 ? "var(--teal)" : "var(--rose)" }}>
              {globalTaux == null ? "—" : `${globalTaux.rate.toFixed(0)} %`}
            </div>
            {globalTaux && <div className="sc-sub" style={{ color: "var(--text-2)", fontSize: 10, marginTop: 2 }}>{globalTaux.won} / {globalTaux.total} paris</div>}
          </div>
        </div>
      )}

      {/* ── GRAPHIQUES VIEW ── */}
      {viewMode === "graphiques" && poches.length > 0 && selectedPoche && (
        <ChartGrid charts={[
          { key: "cat_pie",   title: "Catégories · tout temps",   node: catPieNode },
          { key: "solde_evo", title: `Solde cumulé · ${selectedPoche.nom}`, node: soldeNode },
        ]} />
      )}

      {/* ── BOOKMAKERS VIEW ── */}
      {viewMode === "bookmakers" && poches.map(poche => {
        const isOpen    = openPoches.has(poche.nom);
        const color     = poche.couleur || "var(--gold)";
        const parMois   = moisParisPerPoche[poche.nom] ?? [];
        const parAll    = allParisPerPoche[poche.nom]  ?? [];
        const soldeAll  = calcSolde(parAll);
        const soldeMois = calcSolde(parMois);
        const tr = (() => {
          const settled = parMois.filter(p => p.statut === "gagne" || p.statut === "perdu");
          if (!settled.length) return null;
          const won = settled.filter(isFullyWon).length;
          return { rate: (won / settled.length) * 100, won, total: settled.length };
        })();

        return (
          <div key={poche.id} className="table-card" style={{ marginBottom: 12 }}>
            {/* Accordion header */}
            <div className="poche-header" onClick={() => toggleOpenPoche(poche.nom)}
              style={{ cursor: "pointer", userSelect: "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 10, transform: isOpen ? "rotate(90deg)" : "none",
                  display: "inline-block", transition: "transform .2s", color: "var(--text-2)" }}>▶</span>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <span className="poche-title" style={{ color }}>{poche.nom}</span>
                {/* Solde tout temps */}
                <span style={{ fontSize: 12, color: soldeAll >= 0 ? "var(--teal)" : "var(--rose)", fontFamily: "var(--mono)" }}>
                  {fmt2(soldeAll)}
                </span>
                {/* Solde ce mois badge */}
                {parMois.length > 0 && (
                  <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 4,
                    background: (soldeMois >= 0 ? "var(--teal)" : "var(--rose)") + "22",
                    color: soldeMois >= 0 ? "var(--teal)" : "var(--rose)",
                    border: `1px solid ${soldeMois >= 0 ? "var(--teal)" : "var(--rose)"}` }}>
                    {mois} {fmt2(soldeMois)}
                  </span>
                )}
                {tr && (
                  <span style={{ fontSize: 10, color: tr.rate >= 50 ? "var(--teal)" : "var(--rose)" }}>
                    {tr.rate.toFixed(0)} % ({tr.won}/{tr.total})
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }} onClick={e => e.stopPropagation()}>
                <button className="btn btn-primary btn-sm"
                  onClick={() => setPariModal({ poche: poche.nom, date: defaultDateForMonth(mois), freebet: false, cote: 1.0, statut: "en_cours", selections: [] })}>
                  + Pari
                </button>
                <ExportBtn label={`${poche.nom}.csv`} onExport={() => exportParisPoche(poche.nom)} />
                <ImportBtn label={poche.nom} onParsed={(rows, rowCount) =>
                  setImportPending({ label: poche.nom, rowCount, onConfirm: async (replace) => { await importParisPoche(poche.nom)(rows, replace); reload(); } })} />
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                  onClick={() => { setEditingPoche(poche); setPocheModal(poche); }} title="Modifier">✎</button>
                <button className="btn btn-danger btn-sm" style={{ fontSize: 10 }}
                  onClick={() => setConfirmDelete({ label: poche.nom, onConfirm: () => deletePoche(poche.id!) })} title="Supprimer">✕</button>
              </div>
            </div>

            {/* Accordion body */}
            {isOpen && (
              <>
                <div className="table-head">
                  <span className="table-head-title">Paris · {mois}</span>
                  <span style={{ fontSize: 11, color: "var(--text-2)" }}>{parMois.length} pari{parMois.length !== 1 ? "s" : ""}</span>
                </div>
                <PariTable paris={parMois} pocheName={poche.nom} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
