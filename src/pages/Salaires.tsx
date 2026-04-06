import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Brush } from "recharts";
import { TOOLTIP_STYLE, tickerColor } from "../constants";

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
  const [salaires, setSalaires] = useState<Salaire[]>([]);
  const [modal, setModal] = useState(false);
  const [expChart, setExpChart] = useState<"sal"|"prime"|null>(null);
  const [brushSal, setBrushSal]     = useState<{start:number;end:number}|null>(null);
  const [brushPrime, setBrushPrime] = useState<{start:number;end:number}|null>(null);

  const load = () => invoke<Salaire[]>("get_salaires").then(setSalaires).catch(console.error);

  const deleteSalaire = async (id: number) => { await invoke("delete_salaire", { id }); load(); };

  const fichesNormales = useMemo(() => salaires.filter(s => s.employeur !== "_PRIME"), [salaires]);
  const primes = useMemo(() => salaires.filter(s => s.employeur === "_PRIME"), [salaires]);

  const salChartData = useMemo(() => {
    const byM: Record<string, { net: number; brut: number }> = {};
    fichesNormales.forEach(s => {
      const m = s.date.slice(0, 7);
      if (!byM[m]) byM[m] = { net: 0, brut: 0 };
      byM[m].net  += s.salaire_net;
      byM[m].brut += s.salaire_brut;
    });
    return Object.entries(byM).sort(([a],[b]) => a.localeCompare(b)).slice(-12).map(([mois, v]) => ({ mois, ...v }));
  }, [fichesNormales]);

  const activePrimeTypes = useMemo(() => {
    const types = new Set<string>();
    primes.forEach(p => {
      const t = (p.notes ?? "").replace(/\[PRIME:([^\]]+)\].*/, "$1").trim();
      if (t) types.add(t);
    });
    return [...types];
  }, [primes]);

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
    return months.map(m => {
      const entry: any = { mois: m };
      activePrimeTypes.forEach(type => {
        const monthly = byMonth[m]?.[type] ?? 0;
        if (monthly > 0) { cumByType[type] += monthly; entry[type] = monthly; }
        entry[`_cum_${type}`] = cumByType[type];
      });
      return entry;
    });
  }, [primes, activePrimeTypes]);

  const normalSalaires = fichesNormales;
  const avgNet = normalSalaires.length
    ? normalSalaires.reduce((s, x) => s + x.salaire_net, 0) / normalSalaires.length
    : 0;
  const totalPrimes = primes.reduce((s, x) => s + (x.primes ?? 0), 0);

  const SalTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const items = payload.filter((p: any) => p.value != null && p.value > 0);
    if (!items.length) return null;
    const COLORS: Record<string, string> = { net: "var(--teal)", brut: "var(--text-1)" };
    const LABELS: Record<string, string> = { net: "Salaire net", brut: "Salaire brut" };
    return (
      <div style={{ ...TOOLTIP_STYLE, padding: "10px 14px", minWidth: 180 }}>
        {label && <div style={{ color: "var(--text-2)", fontSize: 9, marginBottom: 8, letterSpacing: ".05em" }}>{label}</div>}
        {items.map((p: any, i: number) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 2 }}>
            <span style={{ color: COLORS[p.dataKey] ?? "var(--text-1)", fontSize: 10 }}>{LABELS[p.dataKey] ?? p.dataKey}</span>
            <span style={{ color: "var(--text-0)", fontSize: 10 }}>{fmt(Number(p.value))}</span>
          </div>
        ))}
      </div>
    );
  };

  const PrimeTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload;
    const items = payload.filter((p: any) => p.value != null && p.value > 0);
    if (!items.length) return null;
    return (
      <div style={{ ...TOOLTIP_STYLE, padding: "10px 14px", minWidth: 210 }}>
        {label && <div style={{ color: "var(--text-2)", fontSize: 9, marginBottom: 8, letterSpacing: ".05em" }}>{label}</div>}
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

  const charts: { key: "sal"|"prime"; title: string; node: (h: number, isExp: boolean) => React.ReactNode }[] = [];
  if (salChartData.length > 0) charts.push({
    key: "sal", title: "Évolution du salaire net",
    node: (h, isExp) => (
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={salChartData} margin={{ top: 4, right: 8, bottom: isExp ? 28 : 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
          <XAxis dataKey="mois" tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}/>
          <YAxis tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
            tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}k€` : `${v}€`} width={45}/>
          <Tooltip content={<SalTooltip/>}/>
          <Bar dataKey="brut" name="brut" fill="var(--text-2)" radius={[3,3,0,0]} opacity={0.5}/>
          <Bar dataKey="net"  name="net"  fill="var(--teal)"   radius={[3,3,0,0]}/>
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
        </ComposedChart>
      </ResponsiveContainer>
    ),
  });
  if (primeChartData.length > 0) charts.push({
    key: "prime", title: "Primes & Aides",
    node: (h, isExp) => (
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={primeChartData} margin={{ left: 0, right: 5, top: 5, bottom: isExp ? 28 : 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
          <XAxis dataKey="mois" tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
            interval={Math.max(0, Math.floor(primeChartData.length / 6) - 1)}/>
          <YAxis tick={{ fontSize: 8, fontFamily: "JetBrains Mono" }}
            tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k€` : `${v}€`} width={45}/>
          <Tooltip content={<PrimeTooltip/>}/>
          {activePrimeTypes.map(type => (
            <Line key={type} type="monotone" dataKey={type} name={type}
              stroke={tickerColor(type)} strokeWidth={1.5}
              dot={{ r: 3, fill: tickerColor(type) }} connectNulls/>
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
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                    onClick={() => setExpChart(v => v === c.key ? null : c.key)}>
                    {isExp ? "⊟ Réduire" : "⊞ Agrandir"}
                  </button>
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
