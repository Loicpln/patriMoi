import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { LIVRETS_DEF, POCHES, INVEST_SUBCATS, defaultDateForMonth } from "../../constants";
import { curMonth } from "../../context/DeviseContext";
import { useDevise } from "../../context/DeviseContext";
import type { Livret, Position, Vente, Dividende, Versement } from "./types";

// ── Livret Modal ───────────────────────────────────────────────────────────────
export function LivretModal({mois,onClose,onSave}:{mois:string;onClose:()=>void;onSave:()=>void}) {
  const [form,setForm]=useState<Livret>({poche:"livret_a",montant:0,taux:3.0,date:defaultDateForMonth(mois)});
  const s=(k:keyof Livret,v:string|number)=>setForm(f=>({...f,[k]:v}));
  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-title">Mise à jour livret</div>
    <div className="form-grid">
      <div className="field"><label>Poche</label>
        <select value={form.poche} onChange={e=>{const d=LIVRETS_DEF.find(l=>l.key===e.target.value);setForm(f=>({...f,poche:e.target.value,taux:d?.taux??f.taux}));}}>
          {LIVRETS_DEF.map(l=><option key={l.key} value={l.key}>{l.label}</option>)}
        </select></div>
      <div className="field"><label>Montant (€)</label><input type="number" step="0.01" value={form.montant} onChange={e=>s("montant",parseFloat(e.target.value)||0)}/></div>
      <div className="field"><label>Taux (%)</label><input type="number" step="0.01" value={form.taux} onChange={e=>s("taux",parseFloat(e.target.value)||0)}/></div>
      <div className="field"><label>Date</label><input type="date" value={form.date} onChange={e=>s("date",e.target.value)}/></div>
      <div className="field span2"><label>Notes</label><textarea rows={2} value={form.notes??""} onChange={e=>s("notes",e.target.value)}/></div>
    </div>
    <div className="form-actions">
      <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" onClick={async()=>{await invoke("add_livret",{livret:form});onSave();}}>Enregistrer</button>
    </div>
  </div></div>);
}

// ── Intérêt Modal ──────────────────────────────────────────────────────────────
export function InteretModal({mois,onClose,onSave}:{mois:string;onClose:()=>void;onSave:()=>void}) {
  const anneeDefault=parseInt(mois.slice(0,4));
  const [poche,setPoche]=useState("livret_a");
  const [montant,setMontant]=useState(0);
  const [annee,setAnnee]=useState(anneeDefault);
  const [notes,setNotes]=useState("");
  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-title">Ajouter des intérêts annuels</div>
    <div className="form-grid">
      <div className="field"><label>Poche</label>
        <select value={poche} onChange={e=>setPoche(e.target.value)}>
          {LIVRETS_DEF.map(l=><option key={l.key} value={l.key}>{l.label}</option>)}
        </select></div>
      <div className="field"><label>Montant (€)</label><input type="number" step="0.01" value={montant} onChange={e=>setMontant(parseFloat(e.target.value)||0)}/></div>
      <div className="field"><label>Année</label><input type="number" value={annee} onChange={e=>setAnnee(parseInt(e.target.value)||anneeDefault)} min={2000} max={2100}/></div>
      <div className="field span2"><label>Notes</label><textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/></div>
    </div>
    <div className="form-actions">
      <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" onClick={async()=>{
        await invoke("add_livret",{livret:{poche,montant,taux:0,date:`${annee}-12-31`,notes:"[INTERET " + annee + "] " + notes}});
        onSave();
      }}>Enregistrer</button>
    </div>
  </div></div>);
}

// ── Delete Position Rows Modal ─────────────────────────────────────────────────
export function DeletePositionModal({ticker,rows,onClose,onSave}:{ticker:string;rows:Position[];onClose:()=>void;onSave:()=>void}) {
  const [sel,setSel]=useState<Set<number>>(new Set());
  const tog=(id:number)=>setSel(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-title">Supprimer des achats · {ticker}</div>
    <p style={{fontSize:12,color:"var(--text-1)",marginBottom:16}}>Sélectionne les lignes à supprimer :</p>
    <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
      {rows.map(r=>(
        <label key={r.id} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"8px 12px",borderRadius:6,
          background:sel.has(r.id!)?"var(--rose-dim)":"var(--bg-2)",border:`1px solid ${sel.has(r.id!)?"var(--rose)":"var(--border)"}`}}>
          <input type="checkbox" checked={sel.has(r.id!)} onChange={()=>tog(r.id!)}/>
          <span style={{fontSize:12}}>{r.date_achat} — {r.quantite.toFixed(4)} × {r.prix_achat.toFixed(4)} € = {(r.quantite*r.prix_achat).toFixed(2)} €</span>
        </label>
      ))}
    </div>
    <div className="form-actions">
      <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-danger" disabled={sel.size===0} onClick={async()=>{
        for(const id of sel) await invoke("delete_position",{id});
        onSave();
      }}>Supprimer {sel.size} ligne(s)</button>
    </div>
  </div></div>);
}

// ── Position Modal ─────────────────────────────────────────────────────────────
const SUBS_NO_ESPECES = INVEST_SUBCATS.filter(s=>s.key!=="especes");

export function PositionModal({poche,existing,mois=curMonth,onClose,onSave}:{
  poche:string;existing:Position[];mois?:string;onClose:()=>void;onSave:()=>void;
}) {
  const [form,setForm]=useState<Position>({
    poche,ticker:"",nom:"",sous_categorie:SUBS_NO_ESPECES[0].key,
    quantite:0,prix_achat:0,date_achat:defaultDateForMonth(mois),
  });
  const [totalCmd,setTotalCmd]=useState(0);
  const s=(k:keyof Position,v:string|number)=>setForm(f=>({...f,[k]:v}));
  const known=[...new Set(existing.map(p=>p.ticker))];
  const prixUnitaire=form.quantite>0?totalCmd/form.quantite:0;

  const handleTickerChange=(t:string)=>{
    const upper=t.toUpperCase();
    const ex=existing.find(p=>p.ticker===upper);
    setForm(f=>({...f,ticker:upper,nom:ex?.nom??f.nom,sous_categorie:ex?.sous_categorie??f.sous_categorie}));
  };

  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-title">Ajouter position · {POCHES.find(p=>p.key===poche)?.label}</div>
    <div className="form-grid">
      <div className="field"><label>Ticker Yahoo Finance</label>
        <input list="tk-l" value={form.ticker} placeholder="AAPL, BTC-USD, WLD.PA" onChange={e=>handleTickerChange(e.target.value)}/>
        <datalist id="tk-l">{known.map(t=><option key={t} value={t}/>)}</datalist></div>
      <div className="field"><label>Nom</label><input value={form.nom} placeholder="Apple Inc." onChange={e=>s("nom",e.target.value)}/></div>
      <div className="field"><label>Sous-catégorie</label>
        <select value={form.sous_categorie??""} onChange={e=>s("sous_categorie",e.target.value)}>
          {SUBS_NO_ESPECES.map(sc=><option key={sc.key} value={sc.key}>{sc.label}</option>)}
        </select></div>
      <div className="field"><label>Quantité</label>
        <input type="number" step="0.0001" value={form.quantite} onChange={e=>s("quantite",parseFloat(e.target.value)||0)}/></div>
      <div className="field">
        <label>Total commande (€) <span style={{color:"var(--text-2)",fontSize:9}}>montant global</span></label>
        <input type="number" step="0.01" value={totalCmd} onChange={e=>setTotalCmd(parseFloat(e.target.value)||0)}/>
        {prixUnitaire>0&&<div style={{fontSize:10,color:"var(--text-1)",marginTop:3}}>→ Prix unitaire : {prixUnitaire.toFixed(6)} €</div>}
      </div>
      <div className="field"><label>Date d'achat</label><input type="date" value={form.date_achat} onChange={e=>s("date_achat",e.target.value)}/></div>
      <div className="field span2"><label>Notes</label><textarea rows={2} value={form.notes??""} onChange={e=>s("notes",e.target.value)}/></div>
    </div>
    <div className="form-actions">
      <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={form.quantite<=0||totalCmd<=0}
        onClick={async()=>{await invoke("add_position",{position:{...form,prix_achat:prixUnitaire}});onSave();}}>Ajouter</button>
    </div>
  </div></div>);
}

// ── Versement Modal ────────────────────────────────────────────────────────────
export function VersementModal({poche,mois=curMonth,onClose,onSave}:{poche:string;mois?:string;onClose:()=>void;onSave:()=>void}) {
  const [form,setForm]=useState<Versement>({poche,montant:0,date:defaultDateForMonth(mois)});
  const s=(k:keyof Versement,v:string|number)=>setForm(f=>({...f,[k]:v}));
  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-title">Versement cash · {POCHES.find(p=>p.key===poche)?.label}</div>
    <div className="form-grid">
      <div className="field"><label>Montant (€)</label><input type="number" step="0.01" value={form.montant} onChange={e=>s("montant",parseFloat(e.target.value)||0)}/></div>
      <div className="field"><label>Date</label><input type="date" value={form.date} onChange={e=>s("date",e.target.value)}/></div>
      <div className="field span2"><label>Notes</label><textarea rows={2} value={form.notes??""} onChange={e=>s("notes",e.target.value)}/></div>
    </div>
    <div className="form-actions">
      <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" onClick={async()=>{await invoke("add_versement",{versement:form});onSave();}}>Enregistrer</button>
    </div>
  </div></div>);
}

// ── Sell Modal — prix TOTAL de vente ──────────────────────────────────────────
export function SellModal({poche,ticker,nom,maxQty,pru,onClose,onSave}:{
  poche:string;ticker:string;nom:string;maxQty:number;pru:number;
  onClose:()=>void;onSave:()=>void;
}) {
  const {fmt}=useDevise();
  const [qty,setQty]=useState(maxQty);
  const [totalVente,setTotalVente]=useState(parseFloat((pru*maxQty).toFixed(2)));
  const [date,setDate]=useState(defaultDateForMonth(curMonth));
  const [notes,setNotes]=useState("");
  const [err,setErr]=useState("");

  const prixUnitaire=qty>0?totalVente/qty:0;
  const estPnl=(prixUnitaire-pru)*qty;

  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="sell-header">
      <span className="sell-icon">📤</span>
      <div><div className="modal-title" style={{marginBottom:2}}>Vendre · {ticker}</div>
        <div style={{color:"var(--text-1)",fontSize:12}}>{nom} · PRU {fmt(pru)} · {maxQty.toFixed(4)} parts</div></div>
    </div>
    <div className="form-grid">
      <div className="field"><label>Quantité (max {maxQty.toFixed(4)})</label>
        <input type="number" step="0.0001" min="0.0001" max={maxQty} value={qty}
          onChange={e=>{const q=parseFloat(e.target.value)||0;setQty(q);setTotalVente(parseFloat((pru*q).toFixed(2)));}}/></div>
      <div className="field">
        <label>Total vente (€) <span style={{color:"var(--text-2)",fontSize:9}}>montant global</span></label>
        <input type="number" step="0.01" value={totalVente} onChange={e=>setTotalVente(parseFloat(e.target.value)||0)}/>
        {qty>0&&<div style={{fontSize:10,color:"var(--text-1)",marginTop:3}}>→ Prix unitaire : {prixUnitaire.toFixed(6)} €</div>}
      </div>
      <div className="field"><label>Date</label><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
      <div className="field"><label>PnL estimé</label>
        <div style={{padding:"8px 11px",borderRadius:6,border:"1px solid var(--border-l)",background:"var(--bg-0)",
          color:estPnl>=0?"var(--teal)":"var(--rose)",fontSize:13}}>
          {estPnl>=0?"+":""}{fmt(estPnl)}</div></div>
      <div className="field span2"><label>Notes</label><textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/></div>
    </div>
    {err&&<div style={{color:"var(--rose)",fontSize:12,marginBottom:12}}>⚠ {err}</div>}
    <div className="form-actions">
      <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-danger" onClick={async()=>{
        setErr("");
        try{await invoke("sell_position",{poche,ticker,nom,quantiteVendue:qty,prixVente:prixUnitaire,dateVente:date,notes:notes||null});onSave();}
        catch(e:any){setErr(String(e));}
      }}>Confirmer</button>
    </div>
  </div></div>);
}

// ── Dividende Modal ────────────────────────────────────────────────────────────
export function DividendeModal({poche,positions,mois=curMonth,onClose,onSave}:{
  poche:string;positions:Position[];mois?:string;onClose:()=>void;onSave:()=>void;
}) {
  const tickers=[...new Set(positions.map(p=>p.ticker))];
  const [form,setForm]=useState<Dividende>({ticker:tickers[0]??"",poche,montant:0,date:defaultDateForMonth(mois)});
  const s=(k:keyof Dividende,v:string|number)=>setForm(f=>({...f,[k]:v}));
  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-title">Ajouter un dividende</div>
    <div className="form-grid">
      <div className="field"><label>Position</label>
        <select value={form.ticker} onChange={e=>s("ticker",e.target.value)}>
          {tickers.map(t=><option key={t} value={t}>{t}</option>)}
        </select></div>
      <div className="field"><label>Montant (€)</label><input type="number" step="0.01" value={form.montant} onChange={e=>s("montant",parseFloat(e.target.value)||0)}/></div>
      <div className="field"><label>Date</label><input type="date" value={form.date} onChange={e=>s("date",e.target.value)}/></div>
      <div className="field span2"><label>Notes</label><textarea rows={2} value={form.notes??""} onChange={e=>s("notes",e.target.value)}/></div>
    </div>
    <div className="form-actions">
      <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" onClick={async()=>{await invoke("add_dividende",{dividende:form});onSave();}}>Enregistrer</button>
    </div>
  </div></div>);
}
