import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

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

  const load = () => invoke<Salaire[]>("get_salaires").then(setSalaires).catch(console.error);

  const deleteSalaire = async (id: number) => { await invoke("delete_salaire", { id }); load(); };

  // Chart data — last 12 months, primes stacked per month
  const chartData = (() => {
    const byMonth: Record<string, { net: number; brut: number; primes: number }> = {};
    salaires.forEach(s => {
      const m = s.date.slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { net: 0, brut: 0, primes: 0 };
      if (s.employeur !== "_PRIME") {
        byMonth[m].net  += s.salaire_net;
        byMonth[m].brut += s.salaire_brut;
      }
      if (s.primes && s.primes > 0) byMonth[m].primes += s.primes;
    });
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([mois, v]) => ({ mois, ...v }));
  })();

  const normalSalaires = salaires.filter(s => s.employeur !== "_PRIME");
  const avgNet = normalSalaires.length
    ? normalSalaires.reduce((s, x) => s + x.salaire_net, 0) / normalSalaires.length
    : 0;

  const totalPrimes = salaires.reduce((s, x) => s + (x.primes ?? 0), 0);

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
          <div className="stat-value" style={{ fontFamily: "var(--font-serif)" }}>{salaires.length}</div>
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="chart-card">
          <div className="chart-title">Évolution du salaire net (12 derniers mois)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#2a2f3f" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="mois" stroke="#5e5a56" tick={{ fontSize: 11, fontFamily: "DM Mono" }} />
              <YAxis stroke="#5e5a56" tick={{ fontSize: 11, fontFamily: "DM Mono" }}
                tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} />
              <Tooltip
                contentStyle={{ background: "#13161d", border: "1px solid #2a2f3f", borderRadius: 8, fontFamily: "DM Mono", fontSize: 12 }}
                labelStyle={{ color: "#9a9691" }}
                formatter={(v: number, name: string) => [fmt(v), name === "net" ? "Net" : name === "primes" ? "Primes" : "Brut"]}
              />
              <Bar dataKey="net" fill="#7eb8a4" radius={[4, 4, 0, 0]} />
              <Bar dataKey="primes" fill="#c8a96e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table */}
      <div className="table-card">
        <div className="table-header">
          <span className="table-title">Historique</span>
          <button className="btn btn-primary" onClick={() => setModal(true)}>+ Ajouter</button>
        </div>
        {salaires.length === 0 ? (
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
              {salaires.map((s) => {
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
