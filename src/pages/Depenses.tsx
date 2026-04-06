import { useEffect, useMemo, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Brush,
} from "recharts";
import { useDevise, curMonth } from "../context/DeviseContext";
import { DEPENSE_CATEGORIES, TOOLTIP_STYLE, depenseSubColor, defaultDateForMonth } from "../constants";
import MonthSelector from "../components/MonthSelector";

interface Depense {
  id?: number; date: string; categorie: string;
  sous_categorie: string; libelle: string; montant: number; notes?: string;
}

const CATEGORIES: Record<string, string[]> = Object.fromEntries(
  Object.entries(DEPENSE_CATEGORIES).map(([k,v]) => [k, v.subs])
);
const CAT_COLOR: Record<string, string> = Object.fromEntries(
  Object.entries(DEPENSE_CATEGORIES).map(([k,v]) => [k, v.color])
);
const CAT_KEYS = Object.keys(DEPENSE_CATEGORIES);

// ── Chart grid (same as Patrimoine) ──────────────────────────────────────────
function ChartGrid({charts}:{charts:{key:string;title:string;node:(h:number,isExp:boolean)=>React.ReactNode}[]}) {
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
              <div className="chart-title" style={{marginBottom:0,fontSize:12}}>{c.title}</div>
              <button className="btn btn-ghost btn-sm" style={{fontSize:10}}
                onClick={()=>setExp(v=>v===c.key?null:c.key)}>
                {isExp?"⊟ Réduire":"⊞ Agrandir"}
              </button>
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
            <input type="number" step="0.01" value={form.montant}
              onChange={e => set("montant", parseFloat(e.target.value) || 0)} />
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={form.date} onChange={e => set("date", e.target.value)} />
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

export default function Depenses() {
  const { fmt } = useDevise();
  const [depenses, setDepenses]     = useState<Depense[]>([]);
  const [mois, setMois]             = useState(curMonth);
  const [modal, setModal]           = useState(false);
  const [editing, setEditing]       = useState<Depense | null>(null);
  const [loading, setLoading]       = useState(false);
  const [firstMonth, setFirstMonth] = useState<string | undefined>(undefined);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try { setDepenses(await invoke<Depense[]>("get_depenses", { mois: m })); }
    catch { setDepenses([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(mois); }, [mois, load]);

  // Fetch earliest depense date once on mount
  useEffect(() => {
    invoke<Depense[]>("get_depenses", { mois: null }).then(all => {
      const dates = all.map(d => d.date.slice(0, 7)).filter(Boolean).sort();
      if (dates[0]) setFirstMonth(dates[0]);
    }).catch(() => {});
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

  // Outer ordered same as inner (subcats in order of parent category)
  const pieOuter = useMemo(() =>
    CAT_KEYS.flatMap(cat => {
      const v = catMap[cat];
      if (!v) return [];
      return CATEGORIES[cat]
        .filter(sub => v.subs[sub] !== undefined)
        .map(sub => ({ name: sub, value: v.subs[sub], color: depenseSubColor(cat, sub) }));
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

  const CT = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0];
    return (
      <div style={{ ...TOOLTIP_STYLE, padding: "8px 12px" }}>
        <div style={{ color: "var(--text-0)", fontWeight: 500, marginBottom: 4 }}>{p.name}</div>
        <div style={{ color: "var(--gold)" }}>{fmt(p.value)}</div>
        {total > 0 && <div style={{ color: "var(--text-1)", fontSize: 10, marginTop: 2 }}>{((p.value/total)*100).toFixed(1)} %</div>}
      </div>
    );
  };

  const emptyDep: Depense = {
    date: defaultDateForMonth(mois),
    categorie: CAT_KEYS[0], sous_categorie: CATEGORIES[CAT_KEYS[0]]?.[0] ?? "Autre", libelle: "", montant: 0,
  };

  const pieNode = (h: number, _isExp?: boolean) => pieInner.length === 0
    ? <div className="empty">Aucune dépense ce mois.</div>
    : (
      <div style={{ position: "relative", height: h }}>
        <ResponsiveContainer width="100%" height={h}>
          <PieChart>
            <Pie data={pieInner} cx="50%" cy="50%" innerRadius={h*0.22} outerRadius={h*0.33}
              paddingAngle={0} dataKey="value">
              {pieInner.map((e,i) => <Cell key={i} fill={e.color} stroke="var(--bg-1)" strokeWidth={2}/>)}
            </Pie>
            <Pie data={pieOuter} cx="50%" cy="50%" innerRadius={h*0.33} outerRadius={h*0.42}
              paddingAngle={0} dataKey="value">
              {pieOuter.map((e,i) => <Cell key={i} fill={e.color} stroke="var(--bg-1)" strokeWidth={1}/>)}
            </Pie>
            <Tooltip content={<CT/>}/>
            <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle"
              style={{fontFamily:"Playfair Display",fontSize:Math.max(12,h*0.055),fill:"var(--text-0)",fontWeight:"bold"}}>
              {fmt(total)}
            </text>
            <text x="50%" y="56%" textAnchor="middle" dominantBaseline="middle"
              style={{fontFamily:"JetBrains Mono",fontSize:8,fill:"var(--text-2)",letterSpacing:"0.08em"}}>
              TOTAL
            </text>
          </PieChart>
        </ResponsiveContainer>
      </div>
    );

  const barNode = (h: number, _isExp?: boolean) => (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={dailyData} margin={{ left: -10 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
        <XAxis dataKey="jour" tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
          tickFormatter={v => String(v)}
          interval={Math.floor(dailyData.length / 8)}/>
        <YAxis tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
          tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k€` : `${v}€`} width={45}/>
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
          tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}k€` : `${v}€`} width={45}/>
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
      <div className="page-header">
        <h1 className="page-title">Dépenses</h1>
        <p className="page-sub">Suivi mensuel par catégorie</p>
      </div>

      <MonthSelector value={mois} onChange={setMois} firstMonth={firstMonth}/>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", marginBottom:16, gap:8 }}>
        {loading && <span className="spinner"/>}
        <button className="btn btn-primary" onClick={() => setModal(true)}>+ Dépense</button>
      </div>

      {/* Stats */}
      <div className="stat-row">
        <div className="stat-card sc-rose">
          <div className="sc-label">Total du mois</div>
          <div className="sc-value">{fmt(total)}</div>
        </div>
        {pieInner.slice(0,3).map((p,i) => (
          <div key={p.name} className={`stat-card ${["sc-gold","sc-teal","sc-lav"][i]}`}>
            <div className="sc-label">{p.name}</div>
            <div className="sc-value">{fmt(p.value)}</div>
            <div className="sc-sub">{total>0?`${((p.value/total)*100).toFixed(1)} %`:"—"}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <ChartGrid charts={[
        { key:"pie",   title:"Répartition par catégorie / sous-catégorie", node: pieNode },
        { key:"daily", title:`Dépenses par jour · ${mois}`,                node: stackedBarNode },
      ]}/>

      {/* Detail by category — accordion */}
      {orderedCats.map(cat => {
        const subs = grouped[cat];
        const catTotal = Object.values(subs).flat().reduce((s,d) => s+d.montant, 0);
        return (
          <CatAccordion key={cat} cat={cat} subs={subs} catTotal={catTotal} fmt={fmt}
            onEdit={d => setEditing(d)}
            onDelete={async (d) => { await invoke("delete_depense",{id:d.id}); load(mois); }}/>
        );
      })}

      {depenses.length === 0 && !loading && (
        <div className="empty">Aucune dépense enregistrée pour ce mois.</div>
      )}

      {modal && (
        <Modal initial={emptyDep} libelles={libelles} title="Ajouter une dépense"
          onClose={() => setModal(false)}
          onSave={async form => { await invoke("add_depense",{depense:form}); load(mois); }}/>
      )}
      {editing && (
        <Modal initial={editing} libelles={libelles} title="Modifier la dépense"
          onClose={() => setEditing(null)}
          onSave={async form => { await invoke("update_depense",{depense:form}); load(mois); }}/>
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
                  <td>{d.libelle}</td>
                  <td style={{ color:"var(--text-1)" }}>{d.date}</td>
                  <td style={{ color:"var(--rose)" }}>{fmt(d.montant)}</td>
                  <td style={{ display:"flex", gap:4 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => onEdit(d)}>✎</button>
                    <button className="btn btn-danger btn-sm" onClick={() => onDelete(d)}>✕</button>
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
