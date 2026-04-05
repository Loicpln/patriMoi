import { useEffect, useState, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
  PieChart, Pie, Cell,
} from "recharts";
import { useDevise } from "../context/DeviseContext";
const curMonth = new Date().toISOString().slice(0, 7);
import MonthSelector from "../components/MonthSelector";
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE, monthsBetween, DEPENSE_CATEGORIES, depenseSubColor } from "../constants";

interface Salaire { id?: number; date: string; salaire_brut: number; salaire_net: number; primes?: number; employeur: string; }
interface Depense { date: string; categorie: string; sous_categorie: string; montant: number; }
interface Livret  { poche: string; montant: number; date: string; }
interface Position { poche: string; quantite: number; prix_achat: number; date_achat?: string; }

type Page = "dashboard" | "depenses" | "fiches" | "patrimoine" | "parametres";

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

  // Évolution salaire — net + primes empilées (toutes les entrées confondues)
  const evoSal = useMemo(() => {
    const allEntries = salaires.filter(s => s.date);
    if (!allEntries.length) return [];
    const sorted = [...allEntries].sort((a, b) => a.date.localeCompare(b.date));
    const fm = sorted[0].date.slice(0, 7);
    const allMonths = monthsBetween(fm, curMonth);
    // net = salaire_net des fiches normales
    const netByMonth: Record<string, number> = {};
    salaires.filter(s => s.employeur !== "_PRIME").forEach(s => {
      const m = s.date.slice(0, 7);
      netByMonth[m] = (netByMonth[m] ?? 0) + s.salaire_net;
    });
    // primes = toutes les primes (champ `primes`) quelle que soit l'entrée
    const primesByMonth: Record<string, number> = {};
    salaires.forEach(s => {
      if (s.primes && s.primes > 0) {
        const m = s.date.slice(0, 7);
        primesByMonth[m] = (primesByMonth[m] ?? 0) + s.primes;
      }
    });
    return allMonths.map(m => ({
      mois: m,
      net:    netByMonth[m]    ?? null,
      primes: primesByMonth[m] ?? null,
    }));
  }, [salaires]);

  // Pie dépenses du mois sélectionné — 2 anneaux
  const { depPieInner, depPieOuter } = useMemo(() => {
    const catMap: Record<string, { total: number; subs: Record<string, number> }> = {};
    depenses.forEach(d => {
      if (!catMap[d.categorie]) catMap[d.categorie] = { total: 0, subs: {} };
      catMap[d.categorie].total += d.montant;
      catMap[d.categorie].subs[d.sous_categorie] = (catMap[d.categorie].subs[d.sous_categorie] ?? 0) + d.montant;
    });
    const inner = Object.entries(catMap)
      .map(([cat, v]) => ({ name: cat, value: v.total, color: CAT_COLOR[cat] ?? "#888" }))
      .sort((a, b) => b.value - a.value);
    const outer = Object.entries(catMap).flatMap(([cat, v]) =>
      Object.entries(v.subs).map(([sub, val]) => ({ name: sub, value: val, color: depenseSubColor(cat, sub) }))
    );
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
        {/* Évolution salaire net + primes empilées */}
        <div className="chart-card">
          <div className="chart-title">Évolution du salaire net + primes</div>
          {evoSal.length === 0 ? <div className="empty">Aucune fiche de paie.</div> : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={evoSal}>
                <defs>
                  <linearGradient id="gSal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#5fa89e" stopOpacity={.4}/>
                    <stop offset="95%" stopColor="#5fa89e" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gPrm" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#c9a84c" stopOpacity={.5}/>
                    <stop offset="95%" stopColor="#c9a84c" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
                <XAxis dataKey="mois" stroke="var(--text-2)" tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }}
                  interval={Math.max(0, Math.floor(evoSal.length / 8) - 1)}/>
                <YAxis stroke="var(--text-2)" tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }}
                  tickFormatter={v => `${(v / 1000).toFixed(1)}k`}/>
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                  formatter={(v: number, name: string) => [fmt(v), name === "net" ? "Net" : "Primes"]}/>
                <ReferenceLine x={mois} stroke="var(--gold)" strokeDasharray="4 2"/>
                <Area type="monotone" dataKey="net"    stackId="s" stroke="#5fa89e" strokeWidth={2} fill="url(#gSal)" dot={false} connectNulls={false}/>
                <Area type="monotone" dataKey="primes" stackId="s" stroke="#c9a84c" strokeWidth={1.5} fill="url(#gPrm)" dot={false} connectNulls={false}/>
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Dépenses du mois — camembert 2 anneaux dynamique */}
        <div className="chart-card">
          <div className="chart-title">Dépenses par catégorie · {mois}</div>
          {depPieInner.length === 0 ? <div className="empty">Aucune dépense ce mois.</div> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={depPieInner} cx="50%" cy="50%" innerRadius={48} outerRadius={73}
                  paddingAngle={0} dataKey="value">
                  {depPieInner.map((e, i) => <Cell key={i} fill={e.color} stroke="var(--bg-1)" strokeWidth={2}/>)}
                </Pie>
                <Pie data={depPieOuter} cx="50%" cy="50%" innerRadius={73} outerRadius={92}
                  paddingAngle={0} dataKey="value">
                  {depPieOuter.map((e, i) => <Cell key={i} fill={e.color} stroke="var(--bg-1)" strokeWidth={1}/>)}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                  formatter={(v: number, name: string) => [fmt(v), name]}/>
                <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle"
                  style={{ fontFamily: "var(--serif)", fontSize: 14, fill: "var(--text-0)" }}>
                  {fmt(totalDepenses)}
                </text>
                <text x="50%" y="56%" textAnchor="middle" dominantBaseline="middle"
                  style={{ fontFamily: "JetBrains Mono", fontSize: 8, fill: "var(--text-2)", letterSpacing: "0.08em" }}>
                  TOTAL
                </text>
              </PieChart>
            </ResponsiveContainer>
          )}
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
