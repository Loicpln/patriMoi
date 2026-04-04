import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useDevise } from "../context/DeviseContext";
const curMonth = new Date().toISOString().slice(0, 7);
import MonthSelector from "../components/MonthSelector";
import { TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_ITEM_STYLE, monthsBetween } from "../constants";

interface Salaire { id?: number; date: string; salaire_brut: number; salaire_net: number; primes?: number; employeur: string; }
interface Depense { date: string; categorie: string; montant: number; }
interface Livret  { poche: string; montant: number; date: string; }
interface Position { poche: string; quantite: number; prix_achat: number; }

type Page = "dashboard" | "depenses" | "fiches" | "patrimoine" | "parametres";


export default function Dashboard({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { fmt } = useDevise();
  const [mois, setMois] = useState(curMonth);
  const [salaires, setSalaires]   = useState<Salaire[]>([]);
  const [depenses, setDepenses]   = useState<Depense[]>([]);
  const [livrets, setLivrets]     = useState<Livret[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);

  useEffect(() => {
    invoke<Salaire[]>("get_salaires").then(setSalaires).catch(console.error);
    invoke<Depense[]>("get_depenses", { mois: curMonth }).then(setDepenses).catch(console.error);
    invoke<Livret[]>("get_livrets").then(setLivrets).catch(console.error);
    invoke<Position[]>("get_positions", {}).then(setPositions).catch(console.error);
  }, []);

  const dernierSalaire = salaires[0] ?? null;
  const totalDepenses  = depenses.reduce((s, d) => s + d.montant, 0);

  const latestLivrets: Record<string, Livret> = {};
  livrets.forEach(l => { if (!latestLivrets[l.poche] || l.date > latestLivrets[l.poche].date) latestLivrets[l.poche] = l; });
  const totalLivrets = Object.values(latestLivrets).reduce((s, l) => s + l.montant, 0);
  const totalInvesti = positions.reduce((s, p) => s + p.quantite * p.prix_achat, 0);

  const tauxEpargne = dernierSalaire?.salaire_net > 0
    ? Math.max(0, ((dernierSalaire.salaire_net - totalDepenses) / dernierSalaire.salaire_net) * 100)
    : null;

  // Graphique salaires — TOUS les mois depuis la 1ère fiche jusqu'à aujourd'hui
  const evoSal = (() => {
    if (!salaires.length) return [];
    const sorted = [...salaires].sort((a,b) => a.date.localeCompare(b.date));
    const firstMonth = sorted[0].date.slice(0,7);
    const allMonths = monthsBetween(firstMonth, curMonth);
    const byMonth: Record<string, Salaire> = {};
    salaires.forEach(s => { byMonth[s.date.slice(0,7)] = s; });
    return allMonths.map(m => ({
      mois: m,
      net:  byMonth[m]?.salaire_net  ?? null,
      brut: byMonth[m]?.salaire_brut ?? null,
    }));
  })();

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Vue d'ensemble</h1>
        <p className="page-sub">{new Date().toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric" })}</p>
      </div>
      <MonthSelector value={mois} onChange={setMois}/>

      <div className="stat-row">
        {dernierSalaire && (
          <div className="stat-card sc-teal" style={{ cursor:"pointer" }} onClick={() => onNavigate("fiches")}>
            <div className="sc-label">Dernier salaire net</div>
            <div className="sc-value">{fmt(dernierSalaire.salaire_net)}</div>
            <div className="sc-sub">{dernierSalaire.employeur} · {dernierSalaire.date.slice(0,7)}</div>
          </div>
        )}
        <div className="stat-card sc-rose" style={{ cursor:"pointer" }} onClick={() => onNavigate("depenses")}>
          <div className="sc-label">Dépenses ce mois</div>
          <div className="sc-value neg">{fmt(totalDepenses)}</div>
          <div className="sc-sub">{new Date().toLocaleDateString("fr-FR",{month:"long",year:"numeric"})}</div>
        </div>
        {tauxEpargne !== null && (
          <div className="stat-card sc-gold">
            <div className="sc-label">Taux d'épargne</div>
            <div className="sc-value">{tauxEpargne.toFixed(2)} %</div>
            <div className="sc-sub">Revenus − dépenses</div>
          </div>
        )}
        <div className="stat-card sc-lav" style={{ cursor:"pointer" }} onClick={() => onNavigate("patrimoine")}>
          <div className="sc-label">Patrimoine financier</div>
          <div className="sc-value pos">{fmt(totalLivrets + totalInvesti)}</div>
          <div className="sc-sub">Livrets + Investissements</div>
        </div>
      </div>

      <div className="two-col">
        <div className="chart-card">
          <div className="chart-title">Évolution du salaire net — historique complet</div>
          {evoSal.length === 0 ? <div className="empty">Aucune fiche de paie.</div> : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={evoSal} connectNulls={false}>
                <defs>
                  <linearGradient id="gSal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#5fa89e" stopOpacity={.3}/>
                    <stop offset="95%" stopColor="#5fa89e" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
                <XAxis dataKey="mois" stroke="var(--text-2)" tick={{ fontSize:9, fontFamily:"JetBrains Mono" }}
                  interval={Math.max(0, Math.floor(evoSal.length / 8) - 1)}/>
                <YAxis stroke="var(--text-2)" tick={{ fontSize:9, fontFamily:"JetBrains Mono" }} tickFormatter={v=>`${(v/1000).toFixed(1)}k`}/>
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                  formatter={(v:number) => [fmt(v), "Net"]}/>
                <Area type="monotone" dataKey="net" stroke="#5fa89e" strokeWidth={2} fill="url(#gSal)" dot={false} connectNulls={false}/>
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="chart-card">
          <div className="chart-title">Dépenses du mois par catégorie</div>
          {depenses.length === 0 ? <div className="empty">Aucune dépense ce mois.</div> : (() => {
            const map: Record<string, number> = {};
            depenses.forEach(d => { map[d.categorie] = (map[d.categorie] ?? 0) + d.montant; });
            const data = Object.entries(map).map(([cat,val]) => ({ cat, val })).sort((a,b) => b.val-a.val);
            return (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
                  <XAxis dataKey="cat" tick={{ fontSize:9, fontFamily:"JetBrains Mono" }}/>
                  <YAxis tick={{ fontSize:9, fontFamily:"JetBrains Mono" }} tickFormatter={v=>`${v}€`}/>
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE}
                    formatter={(v:number) => [fmt(v)]}/>
                  <Area type="monotone" dataKey="val" stroke="#c9a84c" strokeWidth={2} fill="rgba(201,168,76,.15)" dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
            );
          })()}
        </div>
      </div>

      <div className="section-sep">
        <span className="section-sep-label">Accès rapide</span>
        <div className="section-sep-line"/>
      </div>
      <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
        {[
          { label:"Ajouter une dépense",       page:"depenses",   color:"var(--rose)"      },
          { label:"Ajouter une fiche de paie", page:"fiches",     color:"var(--teal)"      },
          { label:"Mettre à jour mes livrets",  page:"patrimoine", color:"var(--gold)"      },
          { label:"Ajouter une position",       page:"patrimoine", color:"var(--lavender)"  },
        ].map(item => (
          <button key={item.label} className="btn btn-ghost"
            style={{ borderColor:item.color, color:item.color }}
            onClick={() => onNavigate(item.page as Page)}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
