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
import { usePoches } from "../context/PochesContext";
import { NestedPie, bellEffect } from "./patrimoine/shared";
import { useQuotes } from "../hooks/useQuotes";

interface Salaire { id?: number; date: string; salaire_brut: number; salaire_net: number; primes?: number; employeur: string; notes?: string; }
interface Depense { date: string; categorie: string; sous_categorie: string; montant: number; }
interface Livret  { poche: string; montant: number; date: string; notes?: string; }
interface Position { poche: string; ticker: string; quantite: number; prix_achat: number; date_achat?: string; sous_categorie?: string; }
interface Vente    { poche: string; ticker: string; quantite: number; prix_achat: number; pnl: number; date_vente: string; }
interface Versement{ poche: string; montant: number; date: string; }
interface Dividende{ poche: string; montant: number; date: string; }
interface ScpiVal  { poche: string; ticker: string; mois: string; valeur_unit: number; }

function buildScpiMapD(vals: ScpiVal[]): Record<string, Record<string, number>> {
  const m: Record<string, Record<string, number>> = {};
  for (const v of vals) { if (!m[v.ticker]) m[v.ticker] = {}; m[v.ticker][v.mois] = v.valeur_unit; }
  return m;
}
function scpiPriceD(map: Record<string, Record<string, number>>, ticker: string, month: string, fallback: number): number {
  const mm = map[ticker] ?? {};
  const keys = Object.keys(mm).filter(k => k <= month).sort();
  return keys.length ? mm[keys[keys.length - 1]] : fallback;
}

type Page = "dashboard" | "depenses" | "fiches" | "patrimoine" | "parametres";


const CAT_COLOR: Record<string, string> = Object.fromEntries(
  Object.entries(DEPENSE_CATEGORIES).map(([k, v]) => [k, v.color])
);

export default function Dashboard({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { fmt, fmtAxis, setMois: setCtxMois } = useDevise();
  const { poches } = usePoches();
  const [mois, setMois]           = useState(curMonth);
  useEffect(()=>{ setCtxMois(mois); },[mois,setCtxMois]);
  const [salaires, setSalaires]   = useState<Salaire[]>([]);
  const [depenses, setDepenses]   = useState<Depense[]>([]);
  const [livrets, setLivrets]         = useState<Livret[]>([]);
  const [positions, setPositions]     = useState<Position[]>([]);
  const [ventes, setVentes]           = useState<Vente[]>([]);
  const [versements, setVersements]   = useState<Versement[]>([]);
  const [dividendes, setDividendes]   = useState<Dividende[]>([]);
  const [scpiVals, setScpiVals]       = useState<ScpiVal[]>([]);
  const [expChart, setExpChart]       = useState<"sal"|"pie"|null>(null);
  const [brushDash, setBrushDash]     = useState<{start:number;end:number}|null>(null);
  const expSal = expChart === "sal";
  const expPie = expChart === "pie";

  const loadDepenses = useCallback((m: string) => {
    invoke<Depense[]>("get_depenses", { mois: m }).then(setDepenses).catch(() => setDepenses([]));
  }, []);

  useEffect(() => {
    invoke<Salaire[]>("get_salaires").then(setSalaires).catch(console.error);
    invoke<Livret[]>("get_livrets").then(setLivrets).catch(console.error);
    invoke<Position[]>("get_positions", {}).then(setPositions).catch(console.error);
    invoke<Vente[]>("get_ventes").then(setVentes).catch(console.error);
    invoke<Versement[]>("get_versements").then(setVersements).catch(console.error);
    invoke<Dividende[]>("get_dividendes").then(setDividendes).catch(console.error);
    invoke<ScpiVal[]>("get_scpi_valuations").then(setScpiVals).catch(console.error);
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

  // Salaire du mois précédent (pour stats)
  const moisPrec = useMemo(() => {
    const [y, m] = mois.split("-").map(Number);
    return m === 1
      ? `${y - 1}-12`
      : `${y}-${String(m - 1).padStart(2, "0")}`;
  }, [mois]);
  const salaireMois = salaires.find(s => s.employeur !== "_PRIME" && s.date.slice(0, 7) === moisPrec) ?? null;
  const primesMoisPrec = salaires
    .filter(s => s.employeur === "_PRIME" && s.date.slice(0, 7) === moisPrec)
    .reduce((s, p) => s + (p.salaire_net ?? 0), 0);
  const totalPrimes = (salaireMois?.primes ?? 0) + primesMoisPrec;
  const totalRevenus = (salaireMois?.salaire_net ?? 0) + totalPrimes;
  const totalDepenses = depenses.reduce((s, d) => s + d.montant, 0);

  // ── Livrets au mois sélectionné ───────────────────────────────────────────────
  const isInteret = (l: Livret) => (l.notes ?? "").startsWith("[INTERET");
  const totalLivrets = livrets
    .filter(l => !isInteret(l) && l.date.slice(0, 7) <= mois)
    .reduce((s, l) => s + l.montant, 0);

  // ── Portfolio value au mois sélectionné (valeur de marché) ────────────────────
  const scpiPriceMap = useMemo(() => buildScpiMapD(scpiVals), [scpiVals]);
  const allTickers = useMemo(() => {
    const skip = new Set(positions.filter(p => p.sous_categorie === "fond" || p.sous_categorie === "scp").map(p => p.ticker));
    return [...new Set(positions.map(p => p.ticker))].filter(t => !skip.has(t));
  }, [positions]);
  const fromMonthD = useMemo(() => {
    const ds = positions.map(p => p.date_achat?.slice(0, 7) ?? "").filter(Boolean).sort();
    return ds[0] ?? curMonth;
  }, [positions]);
  const { getPrice: _getPriceD } = useQuotes(allTickers, fromMonthD);
  const getPriceD = useCallback((ticker: string, month: string, pru = 0): number => {
    const p = positions.find(pos => pos.ticker === ticker);
    const sc = p?.sous_categorie;
    if (sc === "fond") return 1.0;
    if (sc === "scp") return scpiPriceD(scpiPriceMap, ticker, month, pru);
    return _getPriceD(ticker, month, pru);
  }, [positions, scpiPriceMap, _getPriceD]);

  const totalPortfolioValue = useMemo(() => {
    let total = 0;
    poches.forEach(p => {
      type Ev = { date: string; type: "buy" | "sell"; ticker: string; sc: string; qty: number; price: number };
      const evs: Ev[] = [
        ...positions.filter(pos => pos.poche === p.key && (pos.date_achat ?? "").slice(0, 7) <= mois)
          .map(pos => ({ date: pos.date_achat ?? "", type: "buy" as const, ticker: pos.ticker, sc: pos.sous_categorie ?? "actions", qty: pos.quantite, price: pos.prix_achat })),
        ...ventes.filter(v => v.poche === p.key && v.date_vente.slice(0, 7) <= mois)
          .map(v => ({ date: v.date_vente, type: "sell" as const, ticker: v.ticker, sc: "", qty: v.quantite, price: 0 })),
      ].sort((a, b) => a.date.localeCompare(b.date));
      const byT: Record<string, { q: number; inv: number }> = {};
      evs.forEach(ev => {
        if (ev.type === "buy") {
          if (!byT[ev.ticker]) byT[ev.ticker] = { q: 0, inv: 0 };
          byT[ev.ticker].q += ev.qty; byT[ev.ticker].inv += ev.qty * ev.price;
        } else if (byT[ev.ticker]) {
          const pru = byT[ev.ticker].q > 0 ? byT[ev.ticker].inv / byT[ev.ticker].q : 0;
          byT[ev.ticker].q = Math.max(0, byT[ev.ticker].q - ev.qty);
          byT[ev.ticker].inv = Math.max(0, byT[ev.ticker].inv - ev.qty * pru);
          if (byT[ev.ticker].q <= 1e-9) delete byT[ev.ticker];
        }
      });
      const marketVal = Object.entries(byT).reduce((s, [t, d]) => {
        if (d.q <= 1e-9) return s;
        return s + d.q * getPriceD(t, mois, d.q > 0 ? d.inv / d.q : 0);
      }, 0);
      const pocheCost = Object.values(byT).reduce((s, d) => s + d.inv, 0);
      const versTotal = versements.filter(v => v.poche === p.key && v.date.slice(0, 7) <= mois).reduce((s, v) => s + v.montant, 0);
      const pnlReal   = ventes.filter(v => v.poche === p.key && v.date_vente.slice(0, 7) <= mois).reduce((s, v) => s + v.pnl, 0);
      const divTotal  = dividendes.filter(d => d.poche === p.key && d.date.slice(0, 7) <= mois).reduce((s, d) => s + d.montant, 0);
      const esp = Math.max(0, versTotal + pnlReal + divTotal - pocheCost);
      total += marketVal + esp;
    });
    return total;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, ventes, versements, dividendes, mois, getPriceD]);

  const tauxEpargne = totalRevenus > 0
    ? Math.max(0, ((totalRevenus - totalDepenses) / totalRevenus) * 100)
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
    const raw = allMonths.map(m => {
      const entry: any = { mois: m, net: netByMonth[m] ?? null };
      activePrimeTypesDash.forEach(type => { entry[type] = primeByTypeM[type]?.[m] ?? null; });
      return entry;
    });
    return bellEffect(raw, ["net", ...activePrimeTypesDash]);
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
  
  const hSal = expSal ? 520 : 260;
  const hPie = expPie ? 520 : 260;
  
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="sc-label">Revenus · {moisPrec}</div>
                <div className="sc-value">{fmt(totalRevenus)}</div>
                <div className="sc-sub">{salaireMois.employeur}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0, paddingTop: 2 }}>
                <div style={{ fontSize: 10, color: "var(--text-2)", marginBottom: 3 }}>Salaire net</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", fontFamily: "var(--font-mono)" }}>{fmt(salaireMois.salaire_net)}</div>
                {totalPrimes > 0 && <>
                  <div style={{ fontSize: 10, color: "var(--text-2)", marginTop: 6, marginBottom: 3 }}>Primes</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--teal)", fontFamily: "var(--font-mono)" }}>{fmt(totalPrimes)}</div>
                </>}
              </div>
            </div>
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
          <div className="sc-label">Patrimoine financier · {mois}</div>
          <div className="sc-value pos">{fmt(totalLivrets + totalPortfolioValue)}</div>
          <div className="sc-sub">Livrets + Investissements</div>
        </div>
      </div>

      <div className="two-col">
        {/* Évolution salaire net + prime types empilées */}
        {expChart !== "pie" && <div className="chart-card" style={{marginBottom: 20, height:hSal+52, gridColumn: expSal?"1 / -1":"" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div className="chart-title" style={{ marginBottom: 0 }}>Évolution du salaire net + primes</div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 10, opacity: brushDash ? 1 : 0.35, cursor: brushDash ? "pointer" : "default" }}
                onClick={() => brushDash && setBrushDash(null)} title="Réinitialiser le zoom">↺</button>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                onClick={() => setExpChart(v => v === "sal" ? null : "sal")}>
                {expSal ? "-" : "+"}
              </button>
            </div>
          </div>
          {evoSal.length === 0 ? <div className="empty">Aucune fiche de paie.</div> : (() => {
            const salChartData = expSal ? evoSal : visibleEvoSal;
            return (
            <ResponsiveContainer width="100%" height={hSal}>
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
                  interval={Math.max(0, Math.floor(salChartData.length / 8) - 1)}
                  tickFormatter={(m: string) => { const mo = parseInt(m.slice(5,7)); return ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"][mo-1]+" "+m.slice(2,4); }}/>
                <YAxis stroke="var(--text-2)" tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }}
                  tickFormatter={fmtAxis}/>
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
                      dot={false} connectNulls={false}/>
                  );
                })}
                <Area type="monotone" dataKey="net" stackId="s" stroke="#5fa89e" strokeWidth={2} fill="url(#gSal)"
                  dot={false} connectNulls={false}/>
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
        </div>}

        {/* Dépenses du mois — camembert 2 anneaux dynamique */}
        {expChart !== "sal" && <div className="chart-card" style={{marginBottom: 20, height:hPie+52, gridColumn: expPie?"1 / -1":""}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div className="chart-title" style={{marginBottom:0}}>Dépenses par catégorie · {mois}</div>
            <button className="btn btn-ghost btn-sm" style={{fontSize:10}}
              onClick={() => setExpChart(v => v === "pie" ? null : "pie")}>
              {expPie ? "-" : "+"}
            </button>
          </div>
          {depPieInner.length === 0
            ? <div className="empty">Aucune dépense ce mois.</div>
            : <NestedPie inner={depPieInner} outer={depPieOuter} total={totalDepenses} fmt={fmt} h={hPie}/>
          }
        </div>}
      </div>
    </div>
  );
}
