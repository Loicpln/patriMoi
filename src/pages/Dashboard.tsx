import { useEffect, useState, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Customized,
  Brush,
} from "recharts";
import { useDevise } from "../context/DeviseContext";
const curMonth = new Date().toISOString().slice(0, 7);
import MonthSelector from "../components/MonthSelector";
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE, monthsBetween, DEPENSE_CATEGORIES, DEPENSE_CAT_KEYS, depenseSubColor, tickerColor, PRIME_TYPE_COLORS } from "../constants";
import { NestedPie } from "./patrimoine/shared";

interface Salaire { id?: number; date: string; salaire_brut: number; salaire_net: number; primes?: number; employeur: string; notes?: string; }
interface Depense { date: string; categorie: string; sous_categorie: string; montant: number; }
interface Livret  { poche: string; montant: number; date: string; }
interface Position { poche: string; quantite: number; prix_achat: number; date_achat?: string; }

type Page = "dashboard" | "depenses" | "fiches" | "patrimoine" | "parametres";

function renderIsolatedDot(data: any[], dataKey: string, color: string) {
  return (props: any) => {
    const { cx, cy, index } = props;
    if (cx == null || cy == null) return <g/>;
    const prev1 = data[index - 1]?.[dataKey] ?? null;
    const next1 = data[index + 1]?.[dataKey] ?? null;
    const cur   = data[index]?.[dataKey] ?? null;
    if (cur != null && prev1 == null&& next1 == null) {
      return <circle cx={cx} cy={cy} r={3.5} fill={color} stroke="var(--bg-0)" strokeWidth={1.5}/>;
    }
    return <g/>;
  };
}

const CAT_COLOR: Record<string, string> = Object.fromEntries(
  Object.entries(DEPENSE_CATEGORIES).map(([k, v]) => [k, v.color])
);

export default function Dashboard({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { fmt } = useDevise();
  const [mois, setMois]           = useState(curMonth);
  const [salaires, setSalaires]   = useState<Salaire[]>([]);
  const [depenses, setDepenses]   = useState<Depense[]>([]);
  const [livrets, setLivrets]     = useState<Livret[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [expSal, setExpSal]       = useState(false);
  const [brushDash, setBrushDash] = useState<{start:number;end:number}|null>(null);

  const loadDepenses = useCallback((m: string) => {
    invoke<Depense[]>("get_depenses", { mois: m }).then(setDepenses).catch(() => setDepenses([]));
  }, []);

  useEffect(() => {
    invoke<Salaire[]>("get_salaires").then(setSalaires).catch(console.error);
    invoke<Livret[]>("get_livrets").then(setLivrets).catch(console.error);
    invoke<Position[]>("get_positions", {}).then(setPositions).catch(console.error);
  }, []);

  useEffect(() => { loadDepenses(mois); }, [mois, loadDepenses]);

  const firstMonth = useMemo(() => {
    const dates = [
      ...salaires.map(s => s.date.slice(0, 7)),
      ...livrets.map(l => l.date.slice(0, 7)),
      ...positions.map(p => p.date_achat?.slice(0, 7)).filter(Boolean) as string[],
    ].filter(Boolean).sort();
    return dates[0];
  }, [salaires, livrets, positions]);

  // Salaire du mois sélectionné (pour stats)
  const salaireMois = salaires.find(s => s.employeur !== "_PRIME" && s.date.slice(0, 7) === mois) ?? null;
  const totalDepenses = depenses.reduce((s, d) => s + d.montant, 0);

  const latestLivrets: Record<string, Livret> = {};
  livrets.forEach(l => { if (!latestLivrets[l.poche] || l.date > latestLivrets[l.poche].date) latestLivrets[l.poche] = l; });
  const totalLivrets = Object.values(latestLivrets).reduce((s, l) => s + l.montant, 0);
  const totalInvesti = positions.reduce((s, p) => s + p.quantite * p.prix_achat, 0);

  const tauxEpargne = salaireMois && salaireMois.salaire_net > 0
    ? Math.max(0, ((salaireMois.salaire_net - totalDepenses) / salaireMois.salaire_net) * 100)
    : null;

  // Évolution salaire — net + prime types empilées
  const activePrimeTypesDash = useMemo(() => {
    const types = new Set<string>();
    salaires.filter(s => s.employeur === "_PRIME").forEach(p => {
      const t = (p.notes ?? "").replace(/\[PRIME:([^\]]+)\].*/, "$1").trim();
      if (t) types.add(t);
    });
    return [...types];
  }, [salaires]);

  const evoSal = useMemo(() => {
    const allEntries = salaires.filter(s => s.date);
    if (!allEntries.length) return [];
    const sorted = [...allEntries].sort((a, b) => a.date.localeCompare(b.date));
    const fm = sorted[0].date.slice(0, 7);
    const allMonths = monthsBetween(fm, curMonth);
    const netByMonth: Record<string, number> = {};
    salaires.filter(s => s.employeur !== "_PRIME").forEach(s => {
      const m = s.date.slice(0, 7);
      netByMonth[m] = (netByMonth[m] ?? 0) + s.salaire_net;
    });
    const primeByTypeM: Record<string, Record<string, number>> = {};
    salaires.filter(s => s.employeur === "_PRIME").forEach(p => {
      const m = p.date.slice(0, 7);
      const t = (p.notes ?? "").replace(/\[PRIME:([^\]]+)\].*/, "$1").trim();
      if (!t) return;
      if (!primeByTypeM[t]) primeByTypeM[t] = {};
      primeByTypeM[t][m] = (primeByTypeM[t][m] ?? 0) + (p.primes ?? 0);
    });
    return allMonths.map(m => {
      const entry: any = { mois: m, net: netByMonth[m] ?? null };
      activePrimeTypesDash.forEach(type => { entry[type] = primeByTypeM[type]?.[m] ?? null; });
      return entry;
    });
  }, [salaires, activePrimeTypesDash]);

  // Visible slice for compact zoom preservation
  const visibleEvoSal = useMemo(() =>
    brushDash ? evoSal.slice(brushDash.start, brushDash.end + 1) : evoSal,
  [evoSal, brushDash]);

  // Pie dépenses du mois sélectionné — 2 anneaux
  const { depPieInner, depPieOuter } = useMemo(() => {
    const catMap: Record<string, { total: number; subs: Record<string, number> }> = {};
    depenses.forEach(d => {
      if (!catMap[d.categorie]) catMap[d.categorie] = { total: 0, subs: {} };
      catMap[d.categorie].total += d.montant;
      catMap[d.categorie].subs[d.sous_categorie] = (catMap[d.categorie].subs[d.sous_categorie] ?? 0) + d.montant;
    });
    // Inner: in DEPENSE_CAT_KEYS order (same as Dépenses page)
    const inner = DEPENSE_CAT_KEYS
      .filter(cat => catMap[cat])
      .map(cat => ({ name: cat, value: catMap[cat].total, color: CAT_COLOR[cat] ?? "#888" }));
    // Outer: subcats in DEPENSE_CATEGORIES[cat].subs order (same as Dépenses page)
    const outer = DEPENSE_CAT_KEYS.flatMap(cat => {
      const v = catMap[cat];
      if (!v) return [];
      return (DEPENSE_CATEGORIES[cat]?.subs ?? Object.keys(v.subs))
        .filter(sub => v.subs[sub] !== undefined)
        .map(sub => ({ name: sub, group: cat, value: v.subs[sub], color: depenseSubColor(cat, sub) }));
    });
    return { depPieInner: inner, depPieOuter: outer };
  }, [depenses]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Vue d'ensemble</h1>
        <p className="page-sub">{new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
      </div>
      <MonthSelector value={mois} onChange={setMois} firstMonth={firstMonth}/>

      <div className="stat-row">
        {salaireMois && (
          <div className="stat-card sc-teal" style={{ cursor: "pointer" }} onClick={() => onNavigate("fiches")}>
            <div className="sc-label">Salaire net · {mois}</div>
            <div className="sc-value">{fmt(salaireMois.salaire_net)}</div>
            <div className="sc-sub">{salaireMois.employeur}</div>
          </div>
        )}
        <div className="stat-card sc-rose" style={{ cursor: "pointer" }} onClick={() => onNavigate("depenses")}>
          <div className="sc-label">Dépenses · {mois}</div>
          <div className="sc-value neg">{fmt(totalDepenses)}</div>
        </div>
        {tauxEpargne !== null && (
          <div className="stat-card sc-gold">
            <div className="sc-label">Taux d'épargne · {mois}</div>
            <div className="sc-value">{tauxEpargne.toFixed(2)} %</div>
            <div className="sc-sub">Revenus − dépenses</div>
          </div>
        )}
        <div className="stat-card sc-lav" style={{ cursor: "pointer" }} onClick={() => onNavigate("patrimoine")}>
          <div className="sc-label">Patrimoine financier</div>
          <div className="sc-value pos">{fmt(totalLivrets + totalInvesti)}</div>
          <div className="sc-sub">Livrets + Investissements</div>
        </div>
      </div>

      <div className="two-col">
        {/* Évolution salaire net + prime types empilées */}
        <div className="chart-card" style={expSal ? { gridColumn: "1 / -1" } : {}}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div className="chart-title" style={{ marginBottom: 0 }}>Évolution du salaire net + primes</div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 10, opacity: brushDash ? 1 : 0.35, cursor: brushDash ? "pointer" : "default" }}
                onClick={() => brushDash && setBrushDash(null)} title="Réinitialiser le zoom">↺</button>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                onClick={() => setExpSal(v => !v)}>
                {expSal ? "-" : "+"}
              </button>
            </div>
          </div>
          {evoSal.length === 0 ? <div className="empty">Aucune fiche de paie.</div> : (() => {
            // Compact: slice so zoom is preserved without Brush in DOM. Dot renderer must close over same slice.
            const salChartData = expSal ? evoSal : visibleEvoSal;
            return (
            <ResponsiveContainer width="100%" height={expSal ? 460 : 220}>
              <AreaChart data={salChartData} margin={{left:0,right:5,top:5,bottom:expSal?28:0}}>
                <defs>
                  <linearGradient id="gSal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#5fa89e" stopOpacity={.4}/>
                    <stop offset="95%" stopColor="#5fa89e" stopOpacity={0}/>
                  </linearGradient>
                  {activePrimeTypesDash.map(type => {
                    const c = PRIME_TYPE_COLORS[type] ?? tickerColor(type);
                    return (
                      <linearGradient key={type} id={`gDP_${type.replace(/[^a-zA-Z0-9]/g,"_")}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={c} stopOpacity={.5}/>
                        <stop offset="95%" stopColor={c} stopOpacity={0}/>
                      </linearGradient>
                    );
                  })}
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
                <XAxis dataKey="mois" stroke="var(--text-2)" tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }}
                  interval={Math.max(0, Math.floor(salChartData.length / 8) - 1)}/>
                <YAxis stroke="var(--text-2)" tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }}
                  tickFormatter={v => `${(v / 1000).toFixed(1)}k`}/>
                <Tooltip content={({ active, payload, label }: any) => {
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
                }}/>
                <Customized component={(p: any) => {
                  const N = salChartData.length;
                  if (N === 0) return null;
                  const idx = salChartData.findIndex((d: any) => d.mois === mois);
                  if (idx < 0) return null;
                  const step = N > 1 ? p.offset.width / (N - 1) : p.offset.width;
                  const x = p.offset.left + idx * step;
                  return <g><rect x={x - step / 2} y={p.offset.top} width={Math.max(4, step)}
                    height={p.offset.height}
                    fill="var(--gold)" fillOpacity={0.18} stroke="var(--gold)" strokeOpacity={0.6}
                    strokeDasharray="4 2" strokeWidth={1} pointerEvents="none"/></g>;
                }}/>
                {activePrimeTypesDash.map(type => {
                  const c = PRIME_TYPE_COLORS[type] ?? tickerColor(type);
                  return (
                    <Area key={type} type="monotone" dataKey={type} stackId="s" name={type}
                      stroke={c} strokeWidth={1.5} fill={`url(#gDP_${type.replace(/[^a-zA-Z0-9]/g,"_")})`}
                      dot={renderIsolatedDot(salChartData, type, c)} connectNulls={false}/>
                  );
                })}
                <Area type="monotone" dataKey="net" stackId="s" stroke="#5fa89e" strokeWidth={2} fill="url(#gSal)"
                  dot={renderIsolatedDot(salChartData, "net", "#5fa89e")} connectNulls={false}/>
                {expSal && <Brush dataKey="mois" height={22} travellerWidth={6}
                  stroke="var(--border)" fill="var(--bg-2)"
                  startIndex={brushDash?.start??0}
                  endIndex={brushDash?.end??evoSal.length-1}
                  onChange={(range:any)=>{
                    const{startIndex:s,endIndex:e}=range??{};
                    if(s===undefined||e===undefined)return;
                    setBrushDash(s===0&&e===evoSal.length-1?null:{start:s,end:e});
                  }}
                  tickFormatter={()=>""}/>}
              </AreaChart>
            </ResponsiveContainer>
            );
          })()}
        </div>

        {/* Dépenses du mois — camembert 2 anneaux dynamique */}
        <div className="chart-card">
          <div className="chart-title">Dépenses par catégorie · {mois}</div>
          {depPieInner.length === 0
            ? <div className="empty">Aucune dépense ce mois.</div>
            : <NestedPie inner={depPieInner} outer={depPieOuter} total={totalDepenses} fmt={fmt}/>
          }
        </div>
      </div>

      <div className="section-sep">
        <span className="section-sep-label">Accès rapide</span>
        <div className="section-sep-line"/>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[
          { label: "Ajouter une dépense",       page: "depenses",   color: "var(--rose)"     },
          { label: "Ajouter une fiche de paie", page: "fiches",     color: "var(--teal)"     },
          { label: "Mettre à jour mes livrets",  page: "patrimoine", color: "var(--gold)"     },
          { label: "Ajouter une position",       page: "patrimoine", color: "var(--lavender)" },
        ].map(item => (
          <button key={item.label} className="btn btn-ghost"
            style={{ borderColor: item.color, color: item.color }}
            onClick={() => onNavigate(item.page as Page)}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
