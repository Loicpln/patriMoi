import { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useDevise } from "../context/DeviseContext";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Customized, Brush } from "recharts";
import { TOOLTIP_STYLE, tickerColor, PRIME_TYPE_COLORS, monthsBetween, curMonthStr } from "../constants";
import YearSelector from "../components/YearSelector";

function xPixel(scale: any, value: string): number | null {
  if (!scale) return null;
  const direct = scale(value);
  if (direct != null && !isNaN(direct)) return direct as number;
  const domain: string[] = scale.domain ? (scale.domain() as string[]) : [];
  const idx = domain.indexOf(value);
  if (idx < 0) return null;
  const range: number[] = scale.range ? (scale.range() as number[]) : [0, 0];
  if (domain.length <= 1) return range[0];
  return range[0] + (idx / (domain.length - 1)) * (range[1] - range[0]);
}

function renderIsolatedDot(isolated: Set<string>, color: string) {
  return (props: any) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || !payload?.mois) return <g/>;
    if (!isolated.has(payload.mois)) return <g/>;
    return <circle cx={cx} cy={cy} r={2.5} fill={color} stroke="var(--bg-0)" strokeWidth={1.5}/>;
  };
}

interface Salaire {
  id?: number; date: string; salaire_brut: number; salaire_net: number;
  primes?: number; employeur: string; pdf_path?: string; notes?: string;
}
interface Prime {
  id?: number;
  date: string;
  type_prime: string;
  montant: number;
  notes?: string;
}

interface PdfFile { name: string; path: string; }

const MOIS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

// ── Streak calculator ──────────────────────────────────────────────────────
function calcStreak(salaires: Salaire[]): number {
  const fiches = salaires.filter(s => s.employeur !== "_PRIME");
  if (!fiches.length) return 0;
  const months = new Set(fiches.map(s => s.date.slice(0, 7)));
  let streak = 0;
  const now = new Date();
  let cur = new Date(now.getFullYear(), now.getMonth(), 1);
  // Allow current month to be missing (it's ongoing)
  if (!months.has(`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,"0")}`)) {
    cur = new Date(cur.getFullYear(), cur.getMonth() - 1, 1);
  }
  while (true) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,"0")}`;
    if (!months.has(key)) break;
    streak++;
    cur = new Date(cur.getFullYear(), cur.getMonth() - 1, 1);
  }
  return streak;
}


const PRIME_TYPES = ["Bourse", "Prime d'activité", "Prime de Noël", "Aide au logement", "Allocation familiale",
  "Prime vacances", "Aides activités sportives", "Remboursement impôts", "Prime de parainnage", "Cours particuliers", "Autre aide"];


// ── Date par défaut selon l'année sélectionnée ────────────────────────────
function defaultDateForYear(year: number): string {
  const curYear = new Date().getFullYear();
  if (year >= curYear) return new Date().toISOString().slice(0, 10);
  return `${year}-01-01`;
}

function PrimeModal({ onClose, onSave, defaultDate }: { onClose: ()=>void; onSave: ()=>void; defaultDate: string }) {
  const [type, setType] = useState(PRIME_TYPES[0]);
  const [montant, setMontant] = useState(0);
  const [date, setDate] = useState(defaultDate);
  const [notes, setNotes] = useState("");
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Ajouter une prime / aide</div>
        <div className="form-grid">
          <div className="field"><label>Type</label>
            <select value={type} onChange={e => setType(e.target.value)}>
              {PRIME_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="field"><label>Montant (€)</label>
            <input type="number" step="0.01" value={montant} onChange={e => setMontant(parseFloat(e.target.value)||0)}/>
          </div>
          <div className="field"><label>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}/>
          </div>
          <div className="field span2"><label>Notes</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}/>
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={async () => {
            // Stocké comme salaire spécial: brut=0, net=0, employeur="_PRIME", notes="[PRIME:type] notes"
            await invoke("add_salaire", { salaire: {
              date, salaire_brut: 0, salaire_net: 0, primes: montant,
              employeur: "_PRIME", pdf_path: null,
              notes: "[PRIME:" + type + "] " + notes,
            }});
            onSave();
          }}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

// ── Modal shared form ──────────────────────────────────────────────────────
function SalaireForm({
  initial, employeurs, pdfs, pdfFolder, onSave, onClose, title,
}: {
  initial: Salaire; employeurs: string[]; pdfs: PdfFile[]; pdfFolder: string;
  onSave: (s: Salaire) => Promise<void>; onClose: () => void; title: string;
}) {
  const [form, setForm] = useState<Salaire>(initial);
  const set = (k: keyof Salaire, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="form-grid">
          {/* Employeur avec datalist */}
          <div className="field span2">
            <label>Employeur</label>
            <input
              list="emp-list"
              value={form.employeur}
              onChange={e => set("employeur", e.target.value)}
              placeholder="Nom de l'entreprise"
            />
            <datalist id="emp-list">
              {employeurs.map(e => <option key={e} value={e} />)}
            </datalist>
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={form.date} onChange={e => set("date", e.target.value)} />
          </div>
          <div className="field">
            <label>Salaire brut (€)</label>
            <input type="number" step="0.01" value={form.salaire_brut} onChange={e => set("salaire_brut", parseFloat(e.target.value)||0)} />
          </div>
          <div className="field">
            <label>Salaire net (€)</label>
            <input type="number" step="0.01" value={form.salaire_net} onChange={e => set("salaire_net", parseFloat(e.target.value)||0)} />
          </div>
          <div className="field">
            <label>Primes (€)</label>
            <input type="number" step="0.01" value={form.primes ?? 0} onChange={e => set("primes", parseFloat(e.target.value)||0)} />
          </div>
          {pdfs.length > 0 && (
            <div className="field span2">
              <label>PDF associé</label>
              <select value={form.pdf_path ?? ""} onChange={e => set("pdf_path", e.target.value)}>
                <option value="">— Aucun —</option>
                {pdfs.map(p => <option key={p.path} value={p.path}>{p.name}</option>)}
              </select>
            </div>
          )}
          {!pdfFolder && (
            <div className="field span2" style={{ color: "var(--text-2)", fontSize: 11 }}>
              ⚠ Configurez le dossier PDF dans Paramètres.
            </div>
          )}
          <div className="field span2">
            <label>Notes</label>
            <textarea rows={2} value={form.notes ?? ""} onChange={e => set("notes", e.target.value)} />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={() => onSave(form).then(onClose)}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Detail / Edit modal ────────────────────────────────────────────────────
function DetailModal({
  salaire, employeurs, pdfs, pdfFolder, onClose, onDelete, onUpdate,
}: {
  salaire: Salaire; employeurs: string[]; pdfs: PdfFile[]; pdfFolder: string;
  onClose: () => void; onDelete: () => void; onUpdate: () => void;
}) {
  const { fmt } = useDevise();
  const [editing, setEditing] = useState(false);

  if (editing) return (
    <SalaireForm
      initial={salaire}
      employeurs={employeurs}
      pdfs={pdfs}
      pdfFolder={pdfFolder}
      title={`Modifier · ${salaire.date.slice(0, 7)}`}
      onClose={() => setEditing(false)}
      onSave={async (form) => {
        await invoke("update_salaire", { salaire: form });
        onUpdate();
      }}
    />
  );

  const charge = salaire.salaire_brut > 0
    ? ((salaire.salaire_brut - salaire.salaire_net) / salaire.salaire_brut * 100).toFixed(2)
    : "—";

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{salaire.employeur} · {salaire.date.slice(0,7)}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 22 }}>
          {[
            { label: "Salaire brut",    value: fmt(salaire.salaire_brut), color: "var(--text-0)" },
            { label: "Salaire net",     value: fmt(salaire.salaire_net),  color: "var(--teal)"   },
            { label: "Primes",          value: salaire.primes ? fmt(salaire.primes) : "—", color: "var(--gold)" },
            { label: "Taux de charge",  value: charge !== "—" ? `${charge} %` : "—", color: "var(--text-1)" },
          ].map(item => (
            <div key={item.label} style={{ background: "var(--bg-0)", borderRadius: 8, padding: "14px 16px", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-2)", marginBottom: 8 }}>{item.label}</div>
              <div style={{ fontFamily: "var(--serif)", fontSize: 20, color: item.color }}>{item.value}</div>
            </div>
          ))}
        </div>
        {salaire.notes && (
          <div style={{ color: "var(--text-1)", fontSize: 12, marginBottom: 20, padding: "10px 14px", background: "var(--bg-2)", borderRadius: 6 }}>
            {salaire.notes}
          </div>
        )}
        <div className="form-actions">
          {salaire.pdf_path && (
            <button className="btn btn-teal" onClick={() => invoke("open_pdf", { path: salaire.pdf_path })}>
              📄 Ouvrir PDF
            </button>
          )}
          <button className="btn btn-edit btn-ghost" onClick={() => setEditing(true)}>✎ Modifier</button>
          <button className="btn btn-danger" onClick={async () => { await invoke("delete_salaire", { id: salaire.id }); onDelete(); }}>
            Supprimer
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function Fiches() {
  const { fmt } = useDevise();
  const [salaires, setSalaires] = useState<Salaire[]>([]);
  const [pdfs, setPdfs]         = useState<PdfFile[]>([]);
  const [pdfFolder, setPdfFolder] = useState("");
  const [year, setYear]         = useState(new Date().getFullYear());
  const [selected, setSelected] = useState<Salaire | null>(null);
  const [addModal, setAddModal] = useState(false);
  const [primeModal, setPrimeModal] = useState(false);
  const [primeAddDate, setPrimeAddDate] = useState("");
  const [primesMonthKey, setPrimesMonthKey] = useState<string|null>(null);
  const [salToggle, setSalToggle] = useState<"moyen"|"total">("moyen");
  const [expChart, setExpChart] = useState(false);
  const [brushFiches, setBrushFiches] = useState<{start:number;end:number}|null>(null);

  const load = async () => {
    const s = await invoke<Salaire[]>("get_salaires");
    setSalaires(s);
    const folder = await invoke<string>("get_parametre", { cle: "pdf_folder" }).catch(() => "");
    setPdfFolder(folder);
    if (folder) {
      const files = await invoke<PdfFile[]>("list_pdf_files", { folder }).catch(() => []);
      setPdfs(files);
    }
  };
  useEffect(() => { load(); }, []);

  // Unique employeurs for autocomplete
  const employeurs = useMemo(() => [...new Set(salaires.map(s => s.employeur))], [salaires]);

  // Sépare les fiches normales des primes/aides
  const primes = useMemo(() => salaires.filter(s => s.employeur === "_PRIME"), [salaires]);
  const fichesNormales = useMemo(() => salaires.filter(s => s.employeur !== "_PRIME"), [salaires]);

  const activePrimeTypes = useMemo(() => {
    const types = new Set<string>();
    primes.forEach(p => {
      const t = (p.notes ?? "").replace(/\[PRIME:([^\]]+)\].*/, "$1").trim();
      if (t) types.add(t);
    });
    return [...types];
  }, [primes]);

  const evoData = useMemo(() => {
    const all = [...fichesNormales, ...primes];
    if (!all.length) return [];
    const dates = all.map(s => s.date.slice(0, 7)).filter(Boolean).sort();
    const months = monthsBetween(dates[0], curMonthStr());
    const netByM: Record<string, number> = {};
    fichesNormales.forEach(s => {
      const m = s.date.slice(0, 7);
      netByM[m] = (netByM[m] ?? 0) + s.salaire_net;
    });
    const primeByTypeM: Record<string, Record<string, number>> = {};
    primes.forEach(p => {
      const m = p.date.slice(0, 7);
      const t = (p.notes ?? "").replace(/\[PRIME:([^\]]+)\].*/, "$1").trim();
      if (!t) return;
      if (!primeByTypeM[t]) primeByTypeM[t] = {};
      primeByTypeM[t][m] = (primeByTypeM[t][m] ?? 0) + (p.primes ?? 0);
    });
    return months.map(m => {
      const entry: any = { mois: m, net: netByM[m] ?? null };
      activePrimeTypes.forEach(type => { entry[type] = primeByTypeM[type]?.[m] ?? null; });
      return entry;
    });
  }, [fichesNormales, primes, activePrimeTypes]);

  // Visible slice for compact view zoom preservation
  const visibleEvoData = useMemo(() =>
    brushFiches ? evoData.slice(brushFiches.start, brushFiches.end + 1) : evoData,
  [evoData, brushFiches]);

  // Pre-compute isolated months per series
  const isolatedFiches = useMemo(() => {
    const keys = ["net", ...activePrimeTypes];
    const result: Record<string, Set<string>> = {};
    keys.forEach(key => {
      result[key] = new Set<string>();
      evoData.forEach((row: any, i: number) => {
        const cur  = evoData[i]?.[key] ?? null;
        const prev = evoData[i - 1]?.[key] ?? null;
        const next = evoData[i + 1]?.[key] ?? null;
        if (cur != null && prev == null && next == null) result[key].add(row.mois);
      });
    });
    return result;
  }, [evoData, activePrimeTypes]);

  // Map YYYY-MM → Salaire
  const byMonth: Record<string, Salaire[]> = {};
  fichesNormales.forEach(s => {
    const key = s.date.slice(0,7);
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(s);
  });

  // Years from data + current
  const years = [...new Set([new Date().getFullYear(), ...salaires.map(s => parseInt(s.date.slice(0,4)))])].sort().reverse();

  // Stats for selected year
  const yearSalaires = salaires.filter(s => s.date.startsWith(String(year)));
  const avgBrut  = yearSalaires.length ? yearSalaires.reduce((s,x) => s + x.salaire_brut, 0) / yearSalaires.length : 0;
  const avgNet   = yearSalaires.length ? yearSalaires.reduce((s,x) => s + x.salaire_net, 0)  / yearSalaires.length : 0;
  const totalBrut = yearSalaires.reduce((s,x) => s + x.salaire_brut, 0);
  const totalNet  = yearSalaires.reduce((s,x) => s + x.salaire_net, 0);
  const totalPrimes = yearSalaires.reduce((s,x) => s + (x.primes ?? 0), 0);

  const streak = useMemo(() => calcStreak(salaires), [salaires]);

  const emptySalaire: Salaire = { date: defaultDateForYear(year), salaire_brut: 0, salaire_net: 0, employeur: "", primes: 0 };

  const yearRange = useMemo(() => {
    const yearStr = String(year);
    const inYear = evoData.filter((d: any) => (d.mois as string).startsWith(yearStr));
    if (!inYear.length) return null;
    return { x1: inYear[0].mois as string, x2: inYear[inYear.length - 1].mois as string };
  }, [evoData, year]);

  const EvoTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const items = payload.filter((p: any) => p.value != null && p.value > 0);
    if (!items.length) return null;
    const total = items.reduce((s: number, p: any) => s + Number(p.value), 0);
    return (
      <div style={{ ...TOOLTIP_STYLE, padding: "10px 14px", minWidth: 180 }}>
        {label && <div style={{ color: "var(--text-2)", fontSize: 9, marginBottom: 6, letterSpacing: ".05em" }}>{label}</div>}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
          <span style={{ color: "var(--text-1)", fontSize: 10 }}>Total revenus</span>
          <span style={{ color: "var(--text-0)", fontSize: 11, fontWeight: 700 }}>{fmt(total)}</span>
        </div>
        {items.map((p: any, i: number) => {
          const col = p.dataKey === "net" ? "var(--teal)" : (PRIME_TYPE_COLORS[p.dataKey] ?? p.stroke ?? tickerColor(p.dataKey));
          const lbl = p.dataKey === "net" ? "Salaire net" : p.dataKey;
          return (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 2 }}>
              <span style={{ color: col, fontSize: 10 }}>{lbl}</span>
              <span style={{ color: "var(--text-0)", fontSize: 10 }}>{fmt(Number(p.value))}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 className="page-title">Fiches de paie</h1>
          <p className="page-sub">Calendrier annuel</p>
        </div>
        {streak > 0 && (
          <div className="streak-badge">
            🔥 {streak} mois d'affilée
          </div>
        )}
      </div>

      {/* Year selector + contrôles — sticky */}
      <YearSelector value={year} onChange={setYear} years={years}/>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom:16 }}>
        <span style={{ fontSize: 11, color: "var(--text-2)" }}>Affichage :</span>
        <button
          className={`btn btn-sm ${salToggle === "moyen" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setSalToggle("moyen")}>Moyennes</button>
        <button
          className={`btn btn-sm ${salToggle === "total" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setSalToggle("total")}>Totaux</button>
        <div style={{ flex: 1 }}/>
        <button className="btn btn-ghost btn-sm" onClick={() => setPrimeModal(true)}>+ Prime / Aide</button>
        <button className="btn btn-primary btn-sm" onClick={() => setAddModal(true)}>+ Fiche</button>
      </div>
      <div className="stat-row">
        <div className="stat-card sc-teal">
          <div className="sc-label">Salaire net {salToggle === "moyen" ? "moyen" : "total"} · {year}</div>
          <div className="sc-value">{salToggle === "moyen" ? (avgNet > 0 ? fmt(avgNet) : "—") : (totalNet > 0 ? fmt(totalNet) : "—")}</div>
        </div>
        <div className="stat-card sc-neutral">
          <div className="sc-label">Salaire brut {salToggle === "moyen" ? "moyen" : "total"} · {year}</div>
          <div className="sc-value">{salToggle === "moyen" ? (avgBrut > 0 ? fmt(avgBrut) : "—") : (totalBrut > 0 ? fmt(totalBrut) : "—")}</div>
        </div>
        <div className="stat-card sc-amber">
          <div className="sc-label">Primes {salToggle === "moyen" ? "moyennes" : "totales"} · {year}</div>
          <div className="sc-value">{salToggle === "moyen" ? (yearSalaires.length ? fmt(totalPrimes / yearSalaires.length) : "—") : (totalPrimes > 0 ? fmt(totalPrimes) : "—")}</div>
        </div>
      </div>

      {/* Stacked area chart: net + prime types */}
      {evoData.length > 0 && (() => {
        const h = expChart ? 520 : 260;
        // Compact: render sliced data so zoom is preserved without the Brush DOM element.
        // Isolated-dot renderer must also close over the same slice to keep index alignment.
        const chartData = expChart ? evoData : visibleEvoData;
        return (
          <div className="chart-card" style={{ marginBottom: 20, height:h+52 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div className="chart-title" style={{ marginBottom: 0 }}>Évolution du salaire net + primes</div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 10, opacity: brushFiches ? 1 : 0.35, cursor: brushFiches ? "pointer" : "default" }}
                  onClick={() => brushFiches && setBrushFiches(null)} title="Réinitialiser le zoom">↺</button>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                  onClick={() => setExpChart(v => !v)}>
                  {expChart ? "-" : "+"}
                </button>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={h}>
              <AreaChart data={chartData} margin={{ left: 0, right: 5, top: 5, bottom: expChart ? 28 : 0 }}>
                <defs>
                  <linearGradient id="gFNet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#5fa89e" stopOpacity={.4}/>
                    <stop offset="95%" stopColor="#5fa89e" stopOpacity={0}/>
                  </linearGradient>
                  {activePrimeTypes.map(type => {
                    const c = PRIME_TYPE_COLORS[type] ?? tickerColor(type);
                    return (
                      <linearGradient key={type} id={`gFP_${type.replace(/[^a-zA-Z0-9]/g,"_")}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={c} stopOpacity={.5}/>
                        <stop offset="95%" stopColor={c} stopOpacity={0}/>
                      </linearGradient>
                    );
                  })}
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
                <XAxis dataKey="mois" stroke="var(--text-2)" tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }}
                  interval={Math.max(0, Math.floor(chartData.length / 8) - 1)}/>
                <YAxis stroke="var(--text-2)" tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }}
                  tickFormatter={v => `${(v/1000).toFixed(1)}k`} width={40}/>
                <Tooltip content={<EvoTooltip/>}/>
                {activePrimeTypes.map(type => {
                  const c = PRIME_TYPE_COLORS[type] ?? tickerColor(type);
                  return (
                    <Area key={type} type="monotone" dataKey={type} stackId="s" name={type}
                      stroke={c} strokeWidth={1.5} fill={`url(#gFP_${type.replace(/[^a-zA-Z0-9]/g,"_")})`}
                      dot={renderIsolatedDot(isolatedFiches[type] ?? new Set(), c)} connectNulls={false}/>
                  );
                })}
                <Area type="monotone" dataKey="net" stackId="s" name="net"
                  stroke="#5fa89e" strokeWidth={2} fill="url(#gFNet)"
                  dot={renderIsolatedDot(isolatedFiches["net"] ?? new Set(), "#5fa89e")} connectNulls={false}/>
                {yearRange && (
                  <Customized component={(p: any) => {
                    const Nv = chartData.length; if (Nv <= 0) return null;
                    const idx1 = chartData.findIndex((d: any) => d.mois === yearRange.x1);
                    let idx2 = -1; for (let i = Nv-1; i >= 0; i--) { if ((chartData[i] as any).mois === yearRange.x2) { idx2 = i; break; } }
                    if (idx1 < 0 || idx2 < 0) return null;
                    const denom = Math.max(1, Nv - 1);
                    const step = Nv > 1 ? p.offset.width / (Nv - 1) : p.offset.width;
                    const rx1 = p.offset.left + (idx1 / denom) * p.offset.width;
                    const rx2 = p.offset.left + (idx2 / denom) * p.offset.width;
                    return (
                      <g>
                        <rect x={rx1 - step / 2} y={p.offset.top}
                          width={Math.max(4, rx2 - rx1 + step)} height={p.offset.height}
                          fill="var(--gold)" fillOpacity={0.1}
                          stroke="var(--gold)" strokeOpacity={0.5}
                          strokeDasharray="4 2" strokeWidth={1} pointerEvents="none"/>
                      </g>
                    );
                  }}/>
                )}
                {expChart && <Brush dataKey="mois" height={22} travellerWidth={6}
                  stroke="var(--border)" fill="var(--bg-2)"
                  startIndex={brushFiches?.start ?? 0}
                  endIndex={brushFiches?.end ?? evoData.length - 1}
                  onChange={(range: any) => {
                    const { startIndex: s, endIndex: e } = range ?? {};
                    if (s === undefined || e === undefined) return;
                    setBrushFiches(s === 0 && e === evoData.length - 1 ? null : { start: s, end: e });
                  }}
                  tickFormatter={() => ""}/>}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        );
      })()}

      {/* Calendar grid */}
      <div className="cal-grid">
        {MOIS_FR.map((nomMois, i) => {
          const key = `${year}-${String(i+1).padStart(2,"0")}`;
          const fiches = byMonth[key] ?? [];
          const hasPdf = fiches.some(f => f.pdf_path);
          const monthPrimes = primes.filter(p => p.date.slice(0, 7) === key);
          const isEmpty = fiches.length === 0 && monthPrimes.length === 0;
          return (
            <div key={key} className={`cal-month ${hasPdf ? "has-pdf" : ""}`}
              style={{ opacity: isEmpty ? 0.45 : 1, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
                <span className="cal-month-name">{nomMois}</span>
                <span className="cal-month-year">{year}</span>
              </div>
              {/* Body: left = fiche, right = primes */}
              <div style={{ display: "flex", flex: 1, minHeight: 56 }}>
                {/* Fiche de paye */}
                <div style={{ flex: 1, padding: "6px 10px", borderRight: "1px solid var(--border)",
                  cursor: fiches.length > 0 ? "pointer" : "default" }}
                  onClick={() => fiches.length > 0 && setSelected(fiches[0])}>
                  {fiches.length > 0 ? (
                    <div>
                      <div style={{ color: "var(--teal)", fontSize: 12, fontFamily: "var(--serif)" }}>{fmt(fiches[0].salaire_net)}</div>
                      {fiches[0].primes ? <div style={{ color: "var(--gold)", fontSize: 10 }}>+{fmt(fiches[0].primes)}</div> : null}
                      {hasPdf && <div style={{ fontSize: 9, color: "var(--teal)", marginTop: 2 }}>PDF ●</div>}
                    </div>
                  ) : (
                    <div style={{ color: "var(--text-2)", fontSize: 10 }}>—</div>
                  )}
                </div>
                {/* Primes & aides — click to manage */}
                <div style={{ flex: 1, padding: "6px 8px", overflow: "hidden", cursor: "pointer" }}
                  onClick={() => setPrimesMonthKey(key)}>
                  {monthPrimes.length > 0 ? (
                    <>
                      {monthPrimes.slice(0, 3).map(p => {
                        const pType = (p.notes ?? "").replace(/\[PRIME:([^\]]+)\].*/, "$1").trim();
                        return (
                          <div key={p.id} style={{ marginBottom: 2 }}>
                            <div style={{ color: "var(--gold)", fontSize: 11, fontFamily: "var(--serif)", lineHeight: 1.2 }}>{fmt(p.primes ?? 0)}</div>
                            <div style={{ color: "var(--text-2)", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pType}</div>
                          </div>
                        );
                      })}
                      {monthPrimes.length > 3 && <div style={{ color: "var(--text-2)", fontSize: 9 }}>+{monthPrimes.length - 3}</div>}
                    </>
                  ) : (
                    <div style={{ color: "var(--text-2)", fontSize: 10 }}>—</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <DetailModal
          salaire={selected}
          employeurs={employeurs}
          pdfs={pdfs}
          pdfFolder={pdfFolder}
          onClose={() => setSelected(null)}
          onDelete={() => { setSelected(null); load(); }}
          onUpdate={() => { setSelected(null); load(); }}
        />
      )}
      {addModal && (
        <SalaireForm
          initial={emptySalaire}
          employeurs={employeurs}
          pdfs={pdfs}
          pdfFolder={pdfFolder}
          title="Ajouter une fiche de paie"
          onClose={() => setAddModal(false)}
          onSave={async (form) => { await invoke("add_salaire", { salaire: form }); load(); }}
        />
      )}
      {primeModal && (
        <PrimeModal
          defaultDate={primeAddDate || defaultDateForYear(year)}
          onClose={() => { setPrimeModal(false); setPrimeAddDate(""); }}
          onSave={() => { setPrimeModal(false); setPrimeAddDate(""); load(); }}
        />
      )}

      {primesMonthKey && (() => {
        const monthLabel = MOIS_FR[parseInt(primesMonthKey.slice(5, 7)) - 1] + " " + primesMonthKey.slice(0, 4);
        const monthPrimesList = primes.filter(p => p.date.slice(0, 7) === primesMonthKey);
        return (
          <div className="overlay" onClick={() => setPrimesMonthKey(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div className="modal-title" style={{ marginBottom: 0 }}>Primes &amp; Aides · {monthLabel}</div>
                <button className="btn btn-ghost btn-sm" onClick={() => { setPrimeAddDate(`${primesMonthKey}-01`); setPrimesMonthKey(null); setPrimeModal(true); }}>+ Ajouter</button>
              </div>
              {monthPrimesList.length === 0 ? (
                <div className="empty" style={{ marginBottom: 16 }}>Aucune prime ce mois</div>
              ) : (
                <table style={{ marginBottom: 16 }}>
                  <thead><tr><th>Type</th><th>Montant</th><th>Date</th><th>Notes</th><th></th></tr></thead>
                  <tbody>
                    {monthPrimesList.map(p => {
                      const pType = (p.notes ?? "").replace(/\[PRIME:([^\]]+)\].*/, "$1").trim();
                      const pNotes = (p.notes ?? "").replace(/\[PRIME:[^\]]+\]\s*/, "");
                      return (
                        <tr key={p.id}>
                          <td><span className="badge b-gold">{pType}</span></td>
                          <td style={{ color: "var(--gold)" }}>{fmt(p.primes ?? 0)}</td>
                          <td style={{ color: "var(--text-1)" }}>{p.date}</td>
                          <td style={{ color: "var(--text-2)" }}>{pNotes}</td>
                          <td>
                            <button className="btn btn-danger btn-sm"
                              onClick={async () => { await invoke("delete_salaire", { id: p.id }); load(); }}>
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <div className="form-actions">
                <button className="btn btn-ghost" onClick={() => setPrimesMonthKey(null)}>Fermer</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
