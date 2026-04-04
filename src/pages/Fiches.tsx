import { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useDevise } from "../context/DeviseContext";

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
  if (!salaires.length) return 0;
  const months = new Set(salaires.map(s => s.date.slice(0, 7)));
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


const PRIME_TYPES = ["Bourse", "Prime d\'activité", "Prime de Noël", "Aide au logement", "Allocation familiale", "Autre aide"];

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
  const [salToggle, setSalToggle] = useState<"moyen"|"total">("moyen");

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
  const primes = salaires.filter(s => s.employeur === "_PRIME");
  const fichesNormales = salaires.filter(s => s.employeur !== "_PRIME");

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

  const today = new Date().toISOString().slice(0, 10);
  const emptySalaire: Salaire = { date: today, salaire_brut: 0, salaire_net: 0, employeur: "", primes: 0 };

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

      {/* Stats année */}
      {/* Toggle moyen / total */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 11, color: "var(--text-2)" }}>Affichage :</span>
        <button
          className={`btn btn-sm ${salToggle === "moyen" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setSalToggle("moyen")}>Moyennes</button>
        <button
          className={`btn btn-sm ${salToggle === "total" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setSalToggle("total")}>Totaux</button>
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

      <div className="month-bar">
        <label style={{ color: "var(--text-2)", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase" }}>Année</label>
        <select value={year} onChange={e => setYear(parseInt(e.target.value))}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button className="btn btn-ghost" style={{ marginLeft: "auto" }} onClick={() => setPrimeModal(true)}>+ Prime / Aide</button>
        <button className="btn btn-primary" onClick={() => setAddModal(true)}>+ Fiche</button>
      </div>

      {/* Calendar grid */}
      <div className="cal-grid">
        {MOIS_FR.map((nomMois, i) => {
          const key = `${year}-${String(i+1).padStart(2,"0")}`;
          const fiches = byMonth[key] ?? [];
          const hasPdf = fiches.some(f => f.pdf_path);
          return (
            <div
              key={key}
              className={`cal-month ${hasPdf ? "has-pdf" : ""}`}
              onClick={() => fiches.length > 0 && setSelected(fiches[0])}
              style={{ opacity: fiches.length === 0 ? 0.45 : 1, cursor: fiches.length > 0 ? "pointer" : "default" }}
            >
              <div className="cal-month-name">{nomMois}</div>
              <div className="cal-month-year">{year}</div>
              {fiches.length > 0 ? (
                <div className="cal-month-info">
                  <div style={{ color: "var(--teal)" }}>{fmt(fiches[0].salaire_net)} net</div>
                  {fiches[0].primes ? (
                    <div style={{ color: "var(--gold)", fontSize: 10 }}>+{fmt(fiches[0].primes)} primes</div>
                  ) : null}
                  {hasPdf && <div style={{ fontSize: 10, color: "var(--teal)", marginTop: 4 }}>PDF ●</div>}
                </div>
              ) : (
                <div className="cal-month-info" style={{ color: "var(--text-2)", fontSize: 11 }}>Non renseigné</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Primes & Aides list */}
      {primes.length > 0 && (
        <div className="table-card" style={{ marginTop: 24 }}>
          <div className="table-head">
            <span className="table-head-title">Primes &amp; Aides · {year}</span>
            <span style={{ color: "var(--gold)", fontSize: 12 }}>
              Total : {fmt(primes.filter(p => p.date.startsWith(String(year))).reduce((s, p) => s + (p.primes ?? 0), 0))}
            </span>
          </div>
          <table>
            <thead><tr><th>Type</th><th>Montant</th><th>Date</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {primes.filter(p => p.date.startsWith(String(year))).map(p => (
                <tr key={p.id}>
                  <td>
                    <span className="badge b-gold">
                      {(p.notes ?? "").replace(/\[PRIME:([^\]]+)\].*/, "$1")}
                    </span>
                  </td>
                  <td style={{ color: "var(--gold)" }}>{fmt(p.primes ?? 0)}</td>
                  <td style={{ color: "var(--text-1)" }}>{p.date}</td>
                  <td style={{ color: "var(--text-2)" }}>{(p.notes ?? "").replace(/\[PRIME:[^\]]+\]\s*/, "")}</td>
                  <td>
                    <button className="btn btn-danger btn-sm"
                      onClick={async () => { await invoke("delete_salaire", { id: p.id }); load(); }}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
          defaultDate={new Date().toISOString().slice(0, 10)}
          onClose={() => setPrimeModal(false)}
          onSave={() => { setPrimeModal(false); load(); }}
        />
      )}
    </div>
  );
}
