import { useEffect, useMemo, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { ExportBtn, ImportBtn, ImportModal, ImportPending, exportDepenses, importDepenses } from "./patrimoine/InvestSettings";
import {
  Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Brush,
  ComposedChart, Customized,
} from "recharts";
import { useDevise, curMonth } from "../context/DeviseContext";
import { DEPENSE_CATEGORIES, TOOLTIP_STYLE, depenseSubColor, defaultDateForMonth } from "../constants";
import DatePicker from "../components/DatePicker";
import NumInput from "../components/NumInput";
import MonthSelector from "../components/MonthSelector";
import { NestedPie, bellEffect } from "./patrimoine/shared";

interface Depense {
  id?: number; date: string; categorie: string;
  sous_categorie: string; libelle: string; montant: number; notes?: string;
  recurrence_id?: number;
}

interface DepenseRecurrente {
  id?: number;
  categorie: string;
  sous_categorie: string;
  libelle: string;
  montant: number;
  periodicite: "mensuel" | "annuel" | "hebdomadaire";
  date_debut: string;
  date_fin?: string;
  notes?: string;
}

const CATEGORIES: Record<string, string[]> = Object.fromEntries(
  Object.entries(DEPENSE_CATEGORIES).map(([k,v]) => [k, v.subs])
);
const CAT_COLOR: Record<string, string> = Object.fromEntries(
  Object.entries(DEPENSE_CATEGORIES).map(([k,v]) => [k, v.color])
);
const CAT_KEYS = Object.keys(DEPENSE_CATEGORIES);

// ── Chart grid (same as Patrimoine) ──────────────────────────────────────────
function ChartGrid({charts}:{charts:{key:string;title:string;node:(h:number,isExp:boolean)=>React.ReactNode;onResetZoom?:()=>void;brushActive?:boolean}[]}) {
  const [exp,setExp]=useState<string|null>(null);
  return(
    <div style={{display:"grid",gridTemplateColumns:exp?"1fr":"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:24}}>
      {charts.map(c=>{
        const isExp=exp===c.key;
        if(exp&&!isExp)return null;
        const h=isExp?520:260;
        return(
          <div key={c.key} className="chart-card" style={{margin:0,height:h+52}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div className="chart-title">{c.title}</div>
              <div style={{display:"flex",gap:4,alignItems:"center"}}>
                {c.onResetZoom&&(
                  <button className="btn btn-ghost btn-sm" style={{fontSize:10,opacity:c.brushActive?1:0.35,cursor:c.brushActive?"pointer":"default"}}
                    onClick={()=>c.brushActive&&c.onResetZoom?.()}
                    title="Réinitialiser le zoom">↺</button>
                )}
                <button className="btn btn-ghost btn-sm" style={{fontSize:10}}
                  onClick={()=>setExp(v=>v===c.key?null:c.key)}>
                  {isExp?"-":"+"}
                </button>
              </div>
            </div>
            <div style={{height:h}}>{c.node(h,isExp)}</div>
          </div>
        );
      })}
    </div>
  );
}

function Modal({ initial, libelles, onClose, onSave, title }: {
  initial: Depense; libelles: Record<string, string[]>;
  onClose: () => void; onSave: (d: Depense) => Promise<void>; title: string;
}) {
  const [form, setForm] = useState<Depense>(initial);
  const set = (k: keyof Depense, v: string | number) => setForm(f => ({ ...f, [k]: v }));
  const sousCategs = CATEGORIES[form.categorie] ?? ["Autre"];
  const known = libelles[`${form.categorie}||${form.sous_categorie}`] ?? [];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="form-grid">
          <div className="field">
            <label>Catégorie</label>
            <select value={form.categorie} onChange={e => {
              const cat = e.target.value;
              setForm(f => ({ ...f, categorie: cat, sous_categorie: CATEGORIES[cat]?.[0] ?? "Autre" }));
            }}>
              {CAT_KEYS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Sous-catégorie</label>
            <select value={form.sous_categorie} onChange={e => set("sous_categorie", e.target.value)}>
              {sousCategs.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="field span2">
            <label>Libellé</label>
            <input list="lib-list" value={form.libelle}
              onChange={e => set("libelle", e.target.value)} placeholder="ex: Netflix, Total…" />
            <datalist id="lib-list">{known.map(l => <option key={l} value={l} />)}</datalist>
          </div>
          <div className="field">
            <label>Montant (€)</label>
            <NumInput value={form.montant} onChange={v => set("montant", v)} />
          </div>
          <div className="field">
            <label>Date</label>
            <DatePicker value={form.date} onChange={v => set("date", v)} />
          </div>
          <div className="field span2">
            <label>Notes</label>
            <textarea rows={2} value={form.notes ?? ""} onChange={e => set("notes", e.target.value)} />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={() => onSave(form).then(onClose)}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

const PERIODICITE_LABELS: Record<string, string> = {
  mensuel: "Mensuel",
  annuel: "Annuel",
  hebdomadaire: "Hebdomadaire",
};

const G2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", marginTop: 16 };

function RecurrenteModal({ initial, title, onClose, onSave }: {
  initial: DepenseRecurrente; title: string;
  onClose: () => void; onSave: (r: DepenseRecurrente) => Promise<void>;
}) {
  const [form, setForm] = useState<DepenseRecurrente>({ ...initial });
  const s = (k: keyof DepenseRecurrente, v: string | number) => setForm(f => ({ ...f, [k]: v }));
  const sousCategs = CATEGORIES[form.categorie] ?? ["Autre"];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div style={G2}>
          <div className="field" style={{ margin: 0 }}>
            <label>Catégorie</label>
            <select value={form.categorie} onChange={e => {
              const cat = e.target.value;
              setForm(f => ({ ...f, categorie: cat, sous_categorie: CATEGORIES[cat]?.[0] ?? "Autre" }));
            }}>
              {CAT_KEYS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Sous-catégorie</label>
            <select value={form.sous_categorie} onChange={e => s("sous_categorie", e.target.value)}>
              {sousCategs.map(sc => <option key={sc}>{sc}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Libellé</label>
            <input list="rec-lib-list" value={form.libelle}
              onChange={e => s("libelle", e.target.value)} placeholder="ex: Netflix, Loyer…" />
            <datalist id="rec-lib-list"/>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Montant (€)</label>
            <NumInput value={form.montant} onChange={v => s("montant", v)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Périodicité</label>
            <select value={form.periodicite} onChange={e => s("periodicite", e.target.value as DepenseRecurrente["periodicite"])}>
              <option value="mensuel">Mensuel</option>
              <option value="annuel">Annuel</option>
              <option value="hebdomadaire">Hebdomadaire</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Date de début</label>
            <DatePicker value={form.date_debut} onChange={v => s("date_debut", v)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Date de fin (optionnelle)</label>
            <DatePicker value={form.date_fin ?? ""} onChange={v => setForm(f => ({ ...f, date_fin: v || undefined }))} />
          </div>
          <div className="field" style={{ margin: 0 }} />
          <div className="field" style={{ margin: 0, gridColumn: "1/-1" }}>
            <label>Notes</label>
            <textarea rows={2} value={form.notes ?? ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value || undefined }))} />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={() => onSave(form).then(onClose)}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

function RecurrenteSection({ recurrentes, fmt, onEdit, onDelete }: {
  recurrentes: DepenseRecurrente[]; fmt: (n: number) => string;
  onEdit: (r: DepenseRecurrente) => void;
  onDelete: (r: DepenseRecurrente) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="table-card" style={{ marginBottom: 8 }}>
      <div className="table-head" onClick={() => setOpen(v => !v)} style={{ cursor: "pointer", userSelect: "none" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, transform: open ? "rotate(90deg)" : "none", display: "inline-block", transition: "transform .15s", color: "var(--text-2)" }}>▶</span>
          <span className="table-head-title" style={{ color: "var(--gold)" }}>Dépenses récurrentes</span>
        </span>
        <span style={{ color: "var(--text-1)", fontSize: 12 }}>{recurrentes.length} modèle{recurrentes.length > 1 ? "s" : ""}</span>
      </div>
      {open && (
        <table>
          <thead>
            <tr>
              <th>Libellé</th>
              <th>Catégorie</th>
              <th>Montant</th>
              <th>Périodicité</th>
              <th>Début</th>
              <th>Fin</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {recurrentes.map(r => (
              <tr key={r.id}>
                <td>{r.libelle}</td>
                <td style={{ color: "var(--text-1)" }}>{r.categorie} / {r.sous_categorie}</td>
                <td style={{ color: "var(--rose)" }}>{fmt(r.montant)}</td>
                <td>{PERIODICITE_LABELS[r.periodicite] ?? r.periodicite}</td>
                <td style={{ color: "var(--text-1)" }}>{r.date_debut}</td>
                <td style={{ color: "var(--text-1)" }}>{r.date_fin ?? "∞"}</td>
                <td style={{ display: "flex", gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); onEdit(r); }}>✎</button>
                  <button className="btn btn-danger btn-sm" onClick={e => { e.stopPropagation(); onDelete(r); }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Depenses() {
  const { fmt, fmtAxis, setMois: setCtxMois } = useDevise();
  const [depenses, setDepenses]         = useState<Depense[]>([]);
  const [allDepenses, setAllDepenses]   = useState<Depense[]>([]);
  const [mois, setMois]                 = useState(curMonth);
  useEffect(()=>{ setCtxMois(mois); },[mois,setCtxMois]);
  const [modal, setModal]               = useState(false);
  const [editing, setEditing]           = useState<Depense | null>(null);
  const [loading, setLoading]           = useState(false);
  const [firstMonth, setFirstMonth]     = useState<string | undefined>(undefined);
  const [brushIdxD, setBrushIdxD]       = useState<{start:number;end:number}|null>(null);
  const [importPending, setImportPending] = useState<ImportPending | null>(null);
  const [recurrentes, setRecurrentes]   = useState<DepenseRecurrente[]>([]);
  const [recModal, setRecModal]         = useState(false);
  const [editingRec, setEditingRec]     = useState<DepenseRecurrente | null>(null);
  const [confirmDeleteRec, setConfirmDeleteRec] = useState<{id:number;label:string} | null>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try { setDepenses(await invoke<Depense[]>("get_depenses", { mois: m })); }
    catch { setDepenses([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(mois); }, [mois, load]);

  // Fetch all depenses once on mount (for the global chart)
  const loadAll = useCallback(async () => {
    try {
      const all = await invoke<Depense[]>("get_depenses", { mois: null });
      setAllDepenses(all);
      const dates = all.map(d => d.date.slice(0, 7)).filter(Boolean).sort();
      if (dates[0]) setFirstMonth(dates[0]);
    } catch {}
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);

  const loadRecurrentes = useCallback(async () => {
    try { setRecurrentes(await invoke<DepenseRecurrente[]>("get_depenses_recurrentes")); }
    catch {}
  }, []);
  useEffect(() => { loadRecurrentes(); }, [loadRecurrentes]);

  // Au montage : relancer la génération des récurrentes pour combler d'éventuels trous
  useEffect(() => {
    invoke("process_depenses_recurrentes")
      .then(() => { load(mois); loadAll(); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const libelles = useMemo<Record<string, string[]>>(() => {
    const map: Record<string, Set<string>> = {};
    depenses.forEach(d => {
      const k = `${d.categorie}||${d.sous_categorie}`;
      if (!map[k]) map[k] = new Set();
      if (d.libelle) map[k].add(d.libelle);
    });
    return Object.fromEntries(Object.entries(map).map(([k,v]) => [k,[...v]]));
  }, [depenses]);

  const total = depenses.reduce((s, d) => s + d.montant, 0);

  // Modèles récurrents dont la période couvre le mois sélectionné
  const recurrentesDuMois = useMemo(() => {
    const debut = `${mois}-01`;   // premier jour du mois
    const fin   = `${mois}-31`;   // borne haute : toujours >= dernier jour réel
    return recurrentes.filter(r =>
      r.date_debut <= fin &&
      (!r.date_fin || r.date_fin >= debut)
    );
  }, [recurrentes, mois]);

  // Double-ring pie data — ordered by category key order
  const catMap = useMemo(() => {
    const m: Record<string, {total:number;subs:Record<string,number>}> = {};
    depenses.forEach(d => {
      if (!m[d.categorie]) m[d.categorie] = { total:0, subs:{} };
      m[d.categorie].total += d.montant;
      m[d.categorie].subs[d.sous_categorie] = (m[d.categorie].subs[d.sous_categorie]??0) + d.montant;
    });
    return m;
  }, [depenses]);

  const pieInner = useMemo(() =>
    CAT_KEYS.flatMap(cat => {
      const v = catMap[cat];
      return v ? [{ name: cat, value: v.total, color: CAT_COLOR[cat] ?? "#888" }] : [];
    }),
    [catMap]
  );

  // Outer ordered same as inner (subcats in order of parent category), with group = category name
  const pieOuter = useMemo(() =>
    CAT_KEYS.flatMap(cat => {
      const v = catMap[cat];
      if (!v) return [];
      return CATEGORIES[cat]
        .filter(sub => v.subs[sub] !== undefined)
        .map(sub => ({ name: sub, group: cat, value: v.subs[sub], color: depenseSubColor(cat, sub) }));
    }),
    [catMap]
  );

  // Daily bar chart for selected month
  const dailyData = useMemo(() => {
    const [y, m] = mois.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const byDay: Record<number, number> = {};
    depenses.forEach(d => {
      const day = parseInt(d.date.split("-")[2] ?? "1");
      byDay[day] = (byDay[day] ?? 0) + d.montant;
    });
    return Array.from({ length: daysInMonth }, (_, i) => ({
      jour: i + 1,
      montant: byDay[i + 1] ?? 0,
    }));
  }, [depenses, mois]);

  // ── Monthly stacked data (all months, one entry per month) ──────────────────
  const monthlyStackData = useMemo(() => {
    if (!allDepenses.length) return [];
    const months = [...new Set(allDepenses.map(d => d.date.slice(0, 7)))].sort();
    // Fill gaps up to curMonth
    const first = months[0]; const last = curMonth;
    const full: string[] = [];
    const [fy, fm] = first.split("-").map(Number);
    const [ly, lm] = last.split("-").map(Number);
    let y = fy, m = fm;
    while (y < ly || (y === ly && m <= lm)) {
      full.push(`${y}-${String(m).padStart(2,"0")}`);
      m++; if (m > 12) { m = 1; y++; }
    }
    const raw = full.map(mo => {
      const row: any = { mois: mo };
      const moDepenses = allDepenses.filter(d => d.date.slice(0, 7) === mo);
      CAT_KEYS.forEach(cat => {
        const v = moDepenses.filter(d => d.categorie === cat).reduce((s, d) => s + d.montant, 0);
        row[cat] = v > 0 ? v : null;
      });
      return row;
    });
    return bellEffect(raw, CAT_KEYS);
  }, [allDepenses]);

  const MN_SHORT_D = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];


  const visibleMonthlyData = useMemo(() =>
    brushIdxD ? monthlyStackData.slice(brushIdxD.start, brushIdxD.end + 1) : monthlyStackData,
  [monthlyStackData, brushIdxD]);

  const selectedMonthIdxD = useMemo(() => {
    const d = visibleMonthlyData;
    return d.findIndex((r: any) => r.mois === mois);
  }, [visibleMonthlyData, mois]);

  // ── Monthly chart node ────────────────────────────────────────────────────────
  const MonthlyDepTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const items = payload.filter((p: any) => p.value != null && Number(p.value) > 0);
    if (!items.length) return null;
    const total = items.reduce((s: number, p: any) => s + Number(p.value), 0);
    return (
      <div style={{ ...TOOLTIP_STYLE, padding: "10px 14px", minWidth: 170 }}>
        {label && <div style={{ color: "var(--text-2)", fontSize: 9, marginBottom: 6, letterSpacing: ".05em" }}>{label}</div>}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6, paddingBottom: 5, borderBottom: "1px solid var(--border)" }}>
          <span style={{ color: "var(--text-1)", fontSize: 10 }}>Total</span>
          <span style={{ color: "var(--text-0)", fontSize: 11, fontWeight: 700 }}>{fmt(total)}</span>
        </div>
        {items.map((p: any, i: number) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
            <span style={{ color: p.stroke || "var(--text-1)", fontSize: 10 }}>{p.name || p.dataKey}</span>
            <span style={{ color: "var(--text-0)", fontSize: 10 }}>{fmt(Number(p.value))}</span>
          </div>
        ))}
      </div>
    );
  };

  const monthlyNode = (h: number, isExp?: boolean) => monthlyStackData.length === 0
    ? <div className="empty">Aucune dépense.</div>
    : (() => {
      const d = isExp ? monthlyStackData : visibleMonthlyData;
      return (
        <ResponsiveContainer width="100%" height={h}>
          <ComposedChart data={d} margin={{ left: 0, right: 5, top: 5, bottom: isExp ? 28 : 0 }}>
            <defs>
              {CAT_KEYS.map(cat => (
                <linearGradient key={cat} id={`dmg_${cat.replace(/\W/g,"_")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={CAT_COLOR[cat]} stopOpacity={.8}/>
                  <stop offset="95%" stopColor={CAT_COLOR[cat]} stopOpacity={.15}/>
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
            <XAxis dataKey="mois" tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
              tickFormatter={mo => { const n = parseInt(mo.slice(5,7)); return MN_SHORT_D[n-1]+" "+mo.slice(2,4); }}
              interval={Math.max(0, Math.ceil(d.length / 8) - 1)}/>
            <YAxis tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
              tickFormatter={fmtAxis} width={32}/>
            <Tooltip content={<MonthlyDepTooltip/>}/>
            {CAT_KEYS.map(cat => (
              <Area key={cat} type="monotone" dataKey={cat} stackId="d" name={cat}
                stroke={CAT_COLOR[cat]} strokeWidth={1.5}
                fill={`url(#dmg_${cat.replace(/\W/g,"_")})`}
                connectNulls={false}
                dot={false}
                activeDot={{ r: 4 }}/>
            ))}
            {/* Selected-month highlight zone */}
            {selectedMonthIdxD >= 0 && (
              <Customized component={(p: any) => {
                const N = d.length; if (N === 0) return null;
                const slotW = p.offset.width / N;
                const x = p.offset.left + selectedMonthIdxD * slotW;
                return (
                  <g>
                    <rect x={x} y={p.offset.top} width={slotW}
                      height={p.offset.height}
                      fill="var(--gold)" fillOpacity={0.18}
                      stroke="var(--gold)" strokeOpacity={0.6}
                      strokeDasharray="4 2" strokeWidth={1} pointerEvents="none"/>
                  </g>
                );
              }}/>
            )}
            {isExp && <Brush dataKey="mois" height={22} travellerWidth={6}
              stroke="var(--border)" fill="var(--bg-2)"
              startIndex={brushIdxD?.start ?? 0}
              endIndex={brushIdxD?.end ?? monthlyStackData.length - 1}
              onChange={(range: any) => {
                const { startIndex: s, endIndex: e } = range ?? {};
                if (s === undefined || e === undefined) return;
                setBrushIdxD(s === 0 && e === monthlyStackData.length - 1 ? null : { start: s, end: e });
              }}
              tickFormatter={() => ""}/>}
          </ComposedChart>
        </ResponsiveContainer>
      );
    })();

  // Grouped for accordion display
  const grouped = useMemo(() => {
    const g: Record<string, Record<string, Depense[]>> = {};
    depenses.forEach(d => {
      if (!g[d.categorie]) g[d.categorie] = {};
      if (!g[d.categorie][d.sous_categorie]) g[d.categorie][d.sous_categorie] = [];
      g[d.categorie][d.sous_categorie].push(d);
    });
    return g;
  }, [depenses]);

  // Ordered grouped (same order as CAT_KEYS)
  const orderedCats = CAT_KEYS.filter(c => grouped[c]);

  const emptyDep: Depense = {
    date: defaultDateForMonth(mois),
    categorie: CAT_KEYS[0], sous_categorie: CATEGORIES[CAT_KEYS[0]]?.[0] ?? "Autre", libelle: "", montant: 0,
  };

  const pieNode = (h: number, _isExp?: boolean) => pieInner.length === 0
    ? <div className="empty">Aucune dépense ce mois.</div>
    : <NestedPie inner={pieInner} outer={pieOuter} total={total} fmt={fmt} h={h}/>;

  const barNode = (h: number, _isExp?: boolean) => (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={dailyData} margin={{ left: -10 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
        <XAxis dataKey="jour" tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
          tickFormatter={v => String(v)}
          interval={Math.floor(dailyData.length / 8)}/>
        <YAxis tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
          tickFormatter={fmtAxis} width={32}/>
        <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: "var(--text-0)" }}
          labelStyle={{ color: "var(--text-1)" }}
          labelFormatter={v => `Jour ${v}`}
          formatter={(v: number) => [fmt(v), "Dépenses"]}/>
        {/* Stacked bars by category — ordered by CAT_KEYS */}
        {CAT_KEYS.map(cat => (
          catMap[cat] ? (
            <Bar key={cat} dataKey={cat} stackId="d" fill={CAT_COLOR[cat]} radius={[0,0,0,0]}
              // We need to re-shape dailyData to have per-cat values
            />
          ) : null
        ))}
      </BarChart>
    </ResponsiveContainer>
  );

  // Cumulative daily spend — once spent on day N it stays visible until end of month
  const dailyByCat = useMemo(() => {
    const [y, m] = mois.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    // Sum per day
    const byDay: Record<number, Record<string,number>> = {};
    depenses.forEach(d => {
      const day = parseInt(d.date.split("-")[2] ?? "1");
      if (!byDay[day]) byDay[day] = {};
      byDay[day][d.categorie] = (byDay[day][d.categorie] ?? 0) + d.montant;
    });
    // Build cumulative rows
    const running: Record<string,number> = {};
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const dayData = byDay[day] ?? {};
      Object.entries(dayData).forEach(([cat, val]) => {
        running[cat] = (running[cat] ?? 0) + val;
      });
      return { jour: day, ...Object.fromEntries(Object.entries(running)) };
    });
  }, [depenses, mois]);

  const stackedBarNode = (h: number, isExp?: boolean) => (
    <ResponsiveContainer width="100%" height={h}>
      <AreaChart data={dailyByCat} margin={{ left: -10, bottom: isExp ? 28 : 0 }}>
        <defs>
          {CAT_KEYS.filter(cat => catMap[cat]).map(cat => (
            <linearGradient key={cat} id={`da_${cat.replace(/\W/g,"_")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CAT_COLOR[cat]} stopOpacity={.8}/>
              <stop offset="95%" stopColor={CAT_COLOR[cat]} stopOpacity={.2}/>
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
        <XAxis dataKey="jour" tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
          interval={Math.floor(dailyByCat.length / 8)}/>
        <YAxis tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
          tickFormatter={fmtAxis} width={32}/>
        <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: "var(--text-0)" }}
          labelStyle={{ color: "var(--text-1)" }}
          labelFormatter={v => `Jour ${v}`}
          formatter={(v: number, name: string) => [fmt(v), name]}/>
        {CAT_KEYS.filter(cat => catMap[cat]).map(cat => (
          <Area key={cat} type="monotone" dataKey={cat} stackId="d" name={cat}
            stroke={CAT_COLOR[cat]} strokeWidth={1.5}
            fill={`url(#da_${cat.replace(/\W/g,"_")})`}/>
        ))}
        {isExp && <Brush dataKey="jour" height={22} travellerWidth={6}
          stroke="var(--border)" fill="var(--bg-2)"
          tickFormatter={v => `J${v}`}/>}
      </AreaChart>
    </ResponsiveContainer>
  );

  return (
    <div>
      {importPending && <ImportModal pending={importPending} onClose={() => setImportPending(null)}/>}
      <div className="page-header">
        <h1 className="page-title">Dépenses</h1>
        <p className="page-sub">Suivi mensuel par catégorie</p>
      </div>

      <MonthSelector value={mois} onChange={setMois} firstMonth={firstMonth}/>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", marginBottom:16, gap:8 }}>
        {loading && <span className="spinner"/>}
        <ExportBtn label="depenses.csv" onExport={exportDepenses}/>
        <ImportBtn label="Dépenses" onParsed={(rows, rowCount) => setImportPending({ label: "Dépenses", rowCount, onConfirm: async (replace) => { await importDepenses(rows, replace); load(mois); loadAll(); }})}/>
        <button className="btn btn-ghost btn-sm" onClick={() => { setEditingRec(null); setRecModal(true); }}>+ Récurrente</button>
        <button className="btn btn-primary btn-sm" onClick={() => setModal(true)}>+ Dépense</button>
      </div>

      {/* Stats */}
      <div className="stat-row">
        <div className="stat-card sc-rose">
          <div className="sc-label">Total du mois</div>
          <div className="sc-value">{fmt(total)}</div>
        </div>
        {pieInner.map(p => (
          <div key={p.name} className="stat-card" style={{"--sc-accent": p.color} as React.CSSProperties}>
            <div className="sc-label">{p.name}</div>
            <div className="sc-value">{fmt(p.value)}</div>
            <div className="sc-sub">{total>0?`${((p.value/total)*100).toFixed(1)} %`:"—"}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <ChartGrid charts={[
        { key:"pie",     title:"Répartition par catégorie / sous-catégorie",  node: pieNode },
        { key:"monthly", title:"Évolution des dépenses / mois",               node: monthlyNode,
          onResetZoom: () => setBrushIdxD(null), brushActive: !!brushIdxD },
      ]}/>

      {/* Recurring templates section — only those with an occurrence this month */}
      {recurrentesDuMois.length > 0 && (
        <RecurrenteSection recurrentes={recurrentesDuMois} fmt={fmt}
          onEdit={r => { setEditingRec(r); setRecModal(true); }}
          onDelete={r => setConfirmDeleteRec({ id: r.id!, label: r.libelle })}
        />
      )}

      {/* Detail by category — accordion */}
      {orderedCats.map(cat => {
        const subs = grouped[cat];
        const catTotal = Object.values(subs).flat().reduce((s,d) => s+d.montant, 0);
        return (
          <CatAccordion key={cat} cat={cat} subs={subs} catTotal={catTotal} fmt={fmt}
            onEdit={d => setEditing(d)}
            onDelete={async (d) => { await invoke("delete_depense",{id:d.id}); load(mois); loadAll(); }}/>
        );
      })}

      {depenses.length === 0 && !loading && (
        <div className="empty">Aucune dépense enregistrée pour ce mois.</div>
      )}

      {modal && (
        <Modal initial={emptyDep} libelles={libelles} title="Ajouter une dépense"
          onClose={() => setModal(false)}
          onSave={async form => { await invoke("add_depense",{depense:form}); load(mois); loadAll(); }}/>
      )}
      {editing && (
        <Modal initial={editing} libelles={libelles} title="Modifier la dépense"
          onClose={() => setEditing(null)}
          onSave={async form => { await invoke("update_depense",{depense:form}); load(mois); loadAll(); }}/>
      )}

      {recModal && (
        <RecurrenteModal
          initial={editingRec ?? {
            categorie: CAT_KEYS[0],
            sous_categorie: CATEGORIES[CAT_KEYS[0]]?.[0] ?? "Autre",
            libelle: "", montant: 0,
            periodicite: "mensuel",
            date_debut: new Date().toISOString().slice(0, 10),
          }}
          title={editingRec ? "Modifier la dépense récurrente" : "Ajouter une dépense récurrente"}
          onClose={() => { setRecModal(false); setEditingRec(null); }}
          onSave={async (form) => {
            if (editingRec?.id) {
              await invoke("update_depense_recurrente", { rec: { ...form, id: editingRec.id } });
            } else {
              await invoke("add_depense_recurrente", { rec: form });
            }
            // Generate the recurring entries now so they appear immediately in accordions/charts
            await invoke("process_depenses_recurrentes");
            setRecModal(false);
            setEditingRec(null);
            await load(mois);
            await loadAll();
            loadRecurrentes();
          }}
        />
      )}

      {confirmDeleteRec && (
        <div className="overlay" onClick={() => setConfirmDeleteRec(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">Supprimer « {confirmDeleteRec.label} » ?</div>
            <p style={{ color: "var(--text-1)", fontSize: 13, margin: "12px 0 20px" }}>
              Supprimer aussi les occurrences générées automatiquement ?
            </p>
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmDeleteRec(null)}>Annuler</button>
              <button className="btn btn-ghost" onClick={async () => {
                await invoke("delete_depense_recurrente", { id: confirmDeleteRec.id, deleteGenerated: false });
                setConfirmDeleteRec(null);
                loadRecurrentes();
                load(mois); loadAll();
              }}>Garder les occurrences</button>
              <button className="btn btn-danger" onClick={async () => {
                await invoke("delete_depense_recurrente", { id: confirmDeleteRec.id, deleteGenerated: true });
                setConfirmDeleteRec(null);
                loadRecurrentes();
                load(mois); loadAll();
              }}>Tout supprimer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Category accordion ─────────────────────────────────────────────────────────
function CatAccordion({ cat, subs, catTotal, fmt, onEdit, onDelete }: {
  cat: string; subs: Record<string, any[]>; catTotal: number;
  fmt: (n:number)=>string;
  onEdit: (d:any)=>void; onDelete: (d:any)=>void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="table-card" style={{ marginBottom: 8 }}>
      <div className="table-head" onClick={() => setOpen(v=>!v)} style={{ cursor:"pointer", userSelect:"none" }}>
        <span style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:10, transform:open?"rotate(90deg)":"none", display:"inline-block", transition:"transform .15s", color:"var(--text-2)" }}>▶</span>
          <span className="table-head-title" style={{ color: CAT_COLOR[cat] ?? "var(--text-0)" }}>{cat}</span>
        </span>
        <span style={{ color:"var(--text-1)", fontSize:12 }}>{fmt(catTotal)}</span>
      </div>
      {open && (
        <table>
          <thead><tr><th>Sous-catégorie</th><th>Libellé</th><th>Date</th><th>Montant</th><th></th></tr></thead>
          <tbody>
            {Object.entries(subs).map(([sub, deps]) =>
              (deps as any[]).map((d, i) => (
                <tr key={d.id}>
                  {i === 0 && (
                    <td rowSpan={(deps as any[]).length}>
                      <span className="badge" style={{
                        color: depenseSubColor(cat,sub),
                        borderColor: depenseSubColor(cat,sub),
                        background: depenseSubColor(cat,sub)+"22",
                      }}>{sub}</span>
                    </td>
                  )}
                  <td>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
                      {d.recurrence_id != null && (
                        <span title="Dépense récurrente" style={{ fontSize:10, color:"var(--gold)", opacity:.8, lineHeight:1 }}>↻</span>
                      )}
                      {d.libelle}
                    </span>
                  </td>
                  <td style={{ color:"var(--text-1)" }}>{d.date}</td>
                  <td style={{ color:"var(--rose)" }}>{fmt(d.montant)}</td>
                  <td style={{ display:"flex", gap:4 }}>
                    <button className="btn btn-ghost btn-sm"
                      disabled={d.recurrence_id != null}
                      title={d.recurrence_id != null ? "Modifier le modèle récurrent pour changer cette dépense" : undefined}
                      style={d.recurrence_id != null ? { opacity:.3, cursor:"not-allowed" } : undefined}
                      onClick={() => d.recurrence_id == null && onEdit(d)}>✎</button>
                    <button className="btn btn-danger btn-sm"
                      disabled={d.recurrence_id != null}
                      title={d.recurrence_id != null ? "Supprimez le modèle récurrent pour retirer cette dépense" : undefined}
                      style={d.recurrence_id != null ? { opacity:.3, cursor:"not-allowed" } : undefined}
                      onClick={() => d.recurrence_id == null && onDelete(d)}>✕</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
