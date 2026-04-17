import { useState, useMemo, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useDevise } from "../context/DeviseContext";
import { AreaChart, Area, ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Brush, Customized } from "recharts";
import { TOOLTIP_STYLE, PRIME_TYPE_COLORS, tickerColor } from "../constants";
import { bellEffect } from "./patrimoine/shared";

interface Salaire {
  id?: number;
  date: string;
  salaire_brut: number;
  salaire_net: number;
  primes?: number;
  employeur: string;
  pdf_path?: string;
  notes?: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

const today = () => new Date().toISOString().slice(0, 10);

function SalaireModal({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState<Salaire>({
    date: today(), salaire_brut: 0, salaire_net: 0, employeur: "", primes: 0,
  });
  const set = (k: keyof Salaire, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    await invoke("add_salaire", { salaire: form });
    onSave();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Ajouter une fiche de paie</div>
        <div className="form-grid">
          <div className="form-field full">
            <label>Employeur</label>
            <input value={form.employeur} onChange={(e) => set("employeur", e.target.value)} placeholder="Nom de l'entreprise" />
          </div>
          <div className="form-field">
            <label>Date</label>
            <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
          </div>
          <div className="form-field">
            <label>Salaire brut (€)</label>
            <input type="number" value={form.salaire_brut} onChange={(e) => set("salaire_brut", parseFloat(e.target.value))} />
          </div>
          <div className="form-field">
            <label>Salaire net (€)</label>
            <input type="number" value={form.salaire_net} onChange={(e) => set("salaire_net", parseFloat(e.target.value))} />
          </div>
          <div className="form-field">
            <label>Primes (€)</label>
            <input type="number" value={form.primes ?? 0} onChange={(e) => set("primes", parseFloat(e.target.value))} />
          </div>
          <div className="form-field full">
            <label>Notes</label>
            <textarea rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={submit}>Ajouter</button>
        </div>
      </div>
    </div>
  );
}

export default function Salaires() {
  const { fmtAxis } = useDevise();
  const [salaires, setSalaires] = useState<Salaire[]>([]);
  const [modal, setModal] = useState(false);
  const [expChart, setExpChart] = useState<"sal"|"prime"|null>(null);
  const [brushSal, setBrushSal]     = useState<{start:number;end:number}|null>(null);
  const [brushPrime, setBrushPrime] = useState<{start:number;end:number}|null>(null);

  const load = () => invoke<Salaire[]>("get_salaires").then(setSalaires).catch(console.error);
  useEffect(() => { load(); }, []);

  const deleteSalaire = async (id: number) => { await invoke("delete_salaire", { id }); load(); };

  const fichesNormales = useMemo(() => salaires.filter(s => s.employeur !== "_PRIME"), [salaires]);
  const primes = useMemo(() => salaires.filter(s => s.employeur === "_PRIME"), [salaires]);

  const activePrimeTypes = useMemo(() => {
    const types = new Set<string>();
    primes.forEach(p => {
      const t = (p.notes ?? "").replace(/\[PRIME:([^\]]+)\].*/, "$1").trim();
      if (t) types.add(t);
    });
    return [...types];
  }, [primes]);

  // Combined evo data: net + prime types per month (same shape as Dashboard evoSal)
  const salChartData = useMemo(() => {
    const allEntries = salaires.filter(s => s.date);
    if (!allEntries.length) return [];
    const sorted = [...allEntries].sort((a, b) => a.date.localeCompare(b.date));
    const allMonths: string[] = [];
    const [fy, fm] = sorted[0].date.slice(0, 7).split("-").map(Number);
    const now = new Date();
    let y = fy, m = fm;
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
      allMonths.push(`${y}-${String(m).padStart(2,"0")}`);
      m++; if (m > 12) { m = 1; y++; }
    }
    const netByM: Record<string, number> = {};
    fichesNormales.forEach(s => { const mo = s.date.slice(0,7); netByM[mo] = (netByM[mo]??0) + s.salaire_net; });
    const primeByTypeM: Record<string, Record<string, number>> = {};
    primes.forEach(p => {
      const mo = p.date.slice(0,7);
      const t = (p.notes ?? "").replace(/\[PRIME:([^\]]+)\].*/, "$1").trim();
      if (!t) return;
      if (!primeByTypeM[t]) primeByTypeM[t] = {};
      primeByTypeM[t][mo] = (primeByTypeM[t][mo]??0) + (p.primes??0);
    });
    const raw = allMonths.map(mo => {
      const entry: any = { mois: mo, net: netByM[mo] ?? null };
      activePrimeTypes.forEach(type => { entry[type] = primeByTypeM[type]?.[mo] ?? null; });
      return entry;
    });
    return bellEffect(raw, ["net", ...activePrimeTypes]);
  }, [salaires, fichesNormales, primes, activePrimeTypes]);

  // Prime-only chart data (cumulative, for the "Primes & Aides" second chart)
  const primeChartData = useMemo(() => {
    if (!primes.length) return [];
    const byMonth: Record<string, Record<string, number>> = {};
    primes.forEach(p => {
      const m = p.date.slice(0, 7);
      const t = (p.notes ?? "").replace(/\[PRIME:([^\]]+)\].*/, "$1").trim();
      if (!t) return;
      if (!byMonth[m]) byMonth[m] = {};
      byMonth[m][t] = (byMonth[m][t] ?? 0) + (p.primes ?? 0);
    });
    const months = Object.keys(byMonth).sort().slice(-12);
    const cumByType: Record<string, number> = {};
    activePrimeTypes.forEach(t => { cumByType[t] = 0; });
    const raw = months.map(m => {
      const entry: any = { mois: m };
      activePrimeTypes.forEach(type => {
        const monthly = byMonth[m]?.[type] ?? 0;
        if (monthly > 0) { cumByType[type] += monthly; entry[type] = monthly; }
        entry[`_cum_${type}`] = cumByType[type];
      });
      return entry;
    });
    return bellEffect(raw, activePrimeTypes);
  }, [primes, activePrimeTypes]);

  const normalSalaires = fichesNormales;
  const avgNet = normalSalaires.length
    ? normalSalaires.reduce((s, x) => s + x.salaire_net, 0) / normalSalaires.length
    : 0;
  const totalPrimes = primes.reduce((s, x) => s + (x.primes ?? 0), 0);


  const PrimeTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    const items = payload.filter((p: any) => p.value != null && p.value > 0);
    if (!items.length) return null;
    const total = items.reduce((s: number, p: any) => s + Number(p.value), 0);
    return (
      <div style={{ ...TOOLTIP_STYLE, padding: "10px 14px", minWidth: 210 }}>
        {label && <div style={{ color: "var(--text-2)", fontSize: 9, marginBottom: 6, letterSpacing: ".05em" }}>{label}</div>}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
          <span style={{ color: "var(--text-1)", fontSize: 10 }}>Total revenus</span>
          <span style={{ color: "var(--text-0)", fontSize: 11, fontWeight: 700 }}>{fmt(total)}</span>
        </div>
        {items.map((p: any, i: number) => {
          const cum = row?.[`_cum_${p.name}`] ?? 0;
          return (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 2 }}>
              <span style={{ color: p.stroke ?? p.color ?? "var(--text-1)", fontSize: 10 }}>{p.name}</span>
              <span style={{ display: "flex", gap: 5, alignItems: "baseline" }}>
                <span style={{ color: "var(--text-0)", fontSize: 10 }}>{fmt(p.value)}</span>
                <span style={{ color: "var(--text-2)", fontSize: 9 }}>({fmt(cum)})</span>
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const MN_SHORT = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

  const charts: { key: "sal"|"prime"; title: string; node: (h: number, isExp: boolean) => React.ReactNode }[] = [];
  if (salChartData.length > 0) charts.push({
    key: "sal", title: "Évolution du salaire net + primes",
    node: (h, isExp) => {
      const d = isExp ? salChartData : (brushSal ? salChartData.slice(brushSal.start, brushSal.end + 1) : salChartData);
      return (
        <ResponsiveContainer width="100%" height={h}>
          <AreaChart data={d} margin={{ left: 0, right: 5, top: 5, bottom: isExp ? 28 : 0 }}>
            <defs>
              <linearGradient id="gSalP" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#5fa89e" stopOpacity={.4}/>
                <stop offset="95%" stopColor="#5fa89e" stopOpacity={0}/>
              </linearGradient>
              {activePrimeTypes.map(type => {
                const c = PRIME_TYPE_COLORS[type] ?? tickerColor(type);
                return (
                  <linearGradient key={type} id={`gSP_${type.replace(/[^a-zA-Z0-9]/g,"_")}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={c} stopOpacity={.5}/>
                    <stop offset="95%" stopColor={c} stopOpacity={0}/>
                  </linearGradient>
                );
              })}
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
            <XAxis dataKey="mois" tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
              interval={Math.max(0, Math.floor(d.length / 7) - 1)}
              tickFormatter={m => { const mo = parseInt(m.slice(5, 7)); return MN_SHORT[mo - 1]; }}/>
            <YAxis tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
              tickFormatter={fmtAxis} width={32}/>
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
            {activePrimeTypes.map(type => {
              const c = PRIME_TYPE_COLORS[type] ?? tickerColor(type);
              return (
                <Area key={type} type="monotone" dataKey={type} stackId="s" name={type}
                  stroke={c} strokeWidth={1.5} fill={`url(#gSP_${type.replace(/[^a-zA-Z0-9]/g,"_")})`}
                  dot={false} connectNulls={false}/>
              );
            })}
            <Area type="monotone" dataKey="net" stackId="s" stroke="#5fa89e" strokeWidth={2} fill="url(#gSalP)"
              dot={false} connectNulls={false}/>
            {isExp && <Brush dataKey="mois" height={22} travellerWidth={6}
              stroke="var(--border)" fill="var(--bg-2)"
              startIndex={brushSal?.start ?? 0}
              endIndex={brushSal?.end ?? salChartData.length - 1}
              onChange={(range: any) => {
                const { startIndex: s, endIndex: e } = range ?? {};
                if (s === undefined || e === undefined) return;
                setBrushSal(s === 0 && e === salChartData.length - 1 ? null : { start: s, end: e });
              }}
              tickFormatter={() => ""}/>}
          </AreaChart>
        </ResponsiveContainer>
      );
    },
  });
  if (primeChartData.length > 0) charts.push({
    key: "prime", title: "Primes & Aides",
    node: (h, isExp) => (
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={primeChartData} margin={{ left: 0, right: 5, top: 5, bottom: isExp ? 28 : 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
          <XAxis dataKey="mois" tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
            interval={Math.max(0, Math.floor(primeChartData.length / 7) - 1)}
            tickFormatter={m => { const mo = parseInt(m.slice(5, 7)); return MN_SHORT[mo - 1]; }}/>
          <YAxis tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
            tickFormatter={fmtAxis} width={32}/>
          <Tooltip content={<PrimeTooltip/>}/>
          {activePrimeTypes.map(type => (
            <Line key={type} type="monotone" dataKey={type} name={type}
              stroke={tickerColor(type)} strokeWidth={1.5}
              dot={false} connectNulls={false}/>
          ))}
          {isExp && <Brush dataKey="mois" height={22} travellerWidth={6}
            stroke="var(--border)" fill="var(--bg-2)"
            startIndex={brushPrime?.start ?? 0}
            endIndex={brushPrime?.end ?? primeChartData.length - 1}
            onChange={(range: any) => {
              const { startIndex: s, endIndex: e } = range ?? {};
              if (s === undefined || e === undefined) return;
              setBrushPrime(s === 0 && e === primeChartData.length - 1 ? null : { start: s, end: e });
            }}
            tickFormatter={() => ""}/>}
        </ComposedChart>
      </ResponsiveContainer>
    ),
  });

  return (
    <div>
      <h1 className="page-title">Fiches de paie</h1>
      <p className="page-subtitle">Suivi de vos revenus</p>

      {/* Stats */}
      <div className="stat-grid">
        <div className="stat-card accent">
          <div className="stat-label">Salaire net moyen</div>
          <div className="stat-value">{avgNet > 0 ? fmt(avgNet) : "—"}</div>
        </div>
        <div className="stat-card neutral">
          <div className="stat-label">Total primes</div>
          <div className="stat-value">{totalPrimes > 0 ? fmt(totalPrimes) : "—"}</div>
        </div>
        <div className="stat-card neutral">
          <div className="stat-label">Fiches enregistrées</div>
          <div className="stat-value" style={{ fontFamily: "var(--font-serif)" }}>{fichesNormales.length}</div>
        </div>
      </div>

      {/* Expandable charts */}
      {charts.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: expChart ? "1fr" : "repeat(auto-fit,minmax(280px,1fr))", gap: 16, marginBottom: 24 }}>
          {charts.map(c => {
            const isExp = expChart === c.key;
            if (expChart && !isExp) return null;
            const h = isExp ? 520 : 260;
            return (
              <div key={c.key} className="chart-card" style={{ margin: 0, height: h + 52 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div className="chart-title" style={{ marginBottom: 0, fontSize: 12 }}>{c.title}</div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {(() => {
                      const brushActive = c.key === "sal" ? !!brushSal : !!brushPrime;
                      const resetFn = c.key === "sal" ? () => setBrushSal(null) : () => setBrushPrime(null);
                      return (
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 10, opacity: brushActive ? 1 : 0.35, cursor: brushActive ? "pointer" : "default" }}
                          onClick={() => brushActive && resetFn()} title="Réinitialiser le zoom">↺</button>
                      );
                    })()}
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                      onClick={() => setExpChart(v => v === c.key ? null : c.key)}>
                      {isExp ? "-" : "+"}
                    </button>
                  </div>
                </div>
                <div style={{ height: h }}>{c.node(h, isExp)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div className="table-card">
        <div className="table-header">
          <span className="table-title">Historique</span>
          <button className="btn btn-primary" onClick={() => setModal(true)}>+ Ajouter</button>
        </div>
        {fichesNormales.length === 0 ? (
          <div className="empty">Aucune fiche de paie enregistrée.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Employeur</th>
                <th>Brut</th>
                <th>Net</th>
                <th>Primes</th>
                <th>Taux de charge</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fichesNormales.map((s) => {
                const charge = s.salaire_brut > 0
                  ? (((s.salaire_brut - s.salaire_net) / s.salaire_brut) * 100).toFixed(1)
                  : "—";
                return (
                  <tr key={s.id}>
                    <td>{s.date}</td>
                    <td>{s.employeur}</td>
                    <td style={{ color: "var(--text-1)" }}>{fmt(s.salaire_brut)}</td>
                    <td style={{ color: "var(--accent2)" }}>{fmt(s.salaire_net)}</td>
                    <td>{s.primes ? fmt(s.primes) : "—"}</td>
                    <td style={{ color: "var(--text-1)" }}>{charge !== "—" ? `${charge}%` : "—"}</td>
                    <td>
                      <button className="btn btn-danger" style={{ padding: "4px 10px", fontSize: 11 }}
                        onClick={() => s.id && deleteSalaire(s.id)}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {modal && <SalaireModal onClose={() => setModal(false)} onSave={() => { setModal(false); load(); }} />}
    </div>
  );
}
