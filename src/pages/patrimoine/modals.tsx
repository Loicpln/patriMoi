import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { LIVRETS_DEF, INVEST_SUBCATS, TRADEABLE_SUBCATS, defaultDateForMonth } from "../../constants";
import { curMonth, useDevise } from "../../context/DeviseContext";
import { usePoches } from "../../context/PochesContext";
import type { Livret, Position, Vente, Dividende, Versement, ScpiValuation } from "./types";

// ── Layout helpers ─────────────────────────────────────────────────────────────
const G2: React.CSSProperties = { display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px 16px", marginTop:16 };
const F:  React.CSSProperties = { margin:0 };
const S2: React.CSSProperties = { margin:0, gridColumn:"1 / -1" };
const RO: React.CSSProperties = {
  padding:"8px 11px", borderRadius:6, border:"1px solid var(--border-l)",
  background:"var(--bg-0)", fontSize:12, fontFamily:"var(--mono)",
};

// ── Livret Modal ───────────────────────────────────────────────────────────────
export function LivretModal({mois,onClose,onSave}:{mois:string;onClose:()=>void;onSave:()=>void}) {
  const [form,setForm]=useState<Livret>({poche:LIVRETS_DEF[0].key,montant:0,taux:LIVRETS_DEF[0].taux,date:defaultDateForMonth(mois)});
  const s=(k:keyof Livret,v:string|number)=>setForm(f=>({...f,[k]:v}));
  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-title">Mise à jour livret</div>
    <div style={G2}>
      <div className="field" style={F}><label>Poche</label>
        <select value={form.poche} onChange={e=>{const d=LIVRETS_DEF.find(l=>l.key===e.target.value);setForm(f=>({...f,poche:e.target.value,taux:d?.taux??f.taux}));}}>
          {LIVRETS_DEF.map(l=><option key={l.key} value={l.key}>{l.label}</option>)}
        </select></div>
      <div className="field" style={F}><label>Montant (€)</label>
        <input type="number" step="0.01" value={form.montant} onChange={e=>s("montant",parseFloat(e.target.value)||0)}/></div>
      <div className="field" style={F}><label>Taux (%)</label>
        <input type="number" step="0.01" value={form.taux} onChange={e=>s("taux",parseFloat(e.target.value)||0)}/></div>
      <div className="field" style={F}><label>Date</label>
        <input type="date" value={form.date} onChange={e=>s("date",e.target.value)}/></div>
      <div className="field" style={S2}><label>Notes</label>
        <textarea rows={2} value={form.notes??""} onChange={e=>s("notes",e.target.value)}/></div>
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
    <div style={G2}>
      <div className="field" style={F}><label>Poche</label>
        <select value={poche} onChange={e=>setPoche(e.target.value)}>
          {LIVRETS_DEF.map(l=><option key={l.key} value={l.key}>{l.label}</option>)}
        </select></div>
      <div className="field" style={F}><label>Montant (€)</label>
        <input type="number" step="0.01" value={montant} onChange={e=>setMontant(parseFloat(e.target.value)||0)}/></div>
      <div className="field" style={F}><label>Année</label>
        <input type="number" value={annee} onChange={e=>setAnnee(parseInt(e.target.value)||anneeDefault)} min={2000} max={2100}/></div>
      <div className="field" style={S2}><label>Notes</label>
        <textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/></div>
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
const DEL_PAGE_SIZE = 10;

export function DeletePositionModal({ticker,rows,onClose,onSave}:{ticker:string;rows:Position[];onClose:()=>void;onSave:()=>void}) {
  const {fmt}=useDevise();
  const [sel,setSel]=useState<Set<number>>(new Set());
  const [page,setPage]=useState(0);
  const tog=(id:number)=>setSel(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});

  const sorted=useMemo(()=>[...rows].sort((a,b)=>(b.date_achat??"").localeCompare(a.date_achat??"")), [rows]);
  const pages=Math.ceil(sorted.length/DEL_PAGE_SIZE);
  const pageRows=sorted.slice(page*DEL_PAGE_SIZE,(page+1)*DEL_PAGE_SIZE);

  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-title">Récap achats · {ticker}</div>
    <p style={{fontSize:12,color:"var(--text-1)",marginBottom:16}}>Sélectionne les lignes à supprimer :</p>
    <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
      {pageRows.map(r=>(
        <label key={r.id} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"8px 12px",borderRadius:6,
          background:sel.has(r.id!)?"var(--rose-dim)":"var(--bg-2)",border:`1px solid ${sel.has(r.id!)?"var(--rose)":"var(--border)"}`}}>
          <input type="checkbox" checked={sel.has(r.id!)} onChange={()=>tog(r.id!)}/>
          <span style={{fontSize:12}}>
            {r.date_achat??""} — {r.quantite.toFixed(8)} × {r.prix_achat.toFixed(6)} € = {fmt(r.quantite*r.prix_achat)}
          </span>
        </label>
      ))}
    </div>
    {pages>1&&(
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginBottom:12,userSelect:"none"}}>
        <button className="btn btn-ghost btn-sm" disabled={page===0} onClick={()=>setPage(0)} style={{padding:"2px 6px",fontSize:11}}>«</button>
        <button className="btn btn-ghost btn-sm" disabled={page===0} onClick={()=>setPage(p=>p-1)} style={{padding:"2px 6px",fontSize:11}}>‹</button>
        <span style={{fontSize:10,color:"var(--text-2)",minWidth:60,textAlign:"center"}}>{page+1} / {pages}</span>
        <button className="btn btn-ghost btn-sm" disabled={page>=pages-1} onClick={()=>setPage(p=>p+1)} style={{padding:"2px 6px",fontSize:11}}>›</button>
        <button className="btn btn-ghost btn-sm" disabled={page>=pages-1} onClick={()=>setPage(pages-1)} style={{padding:"2px 6px",fontSize:11}}>»</button>
      </div>
    )}
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
  const { poches } = usePoches();
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
    <div className="modal-title">Ajouter position · {poches.find(p=>p.key===poche)?.label??poche}</div>
    <div style={G2}>
      <div className="field" style={F}><label>Ticker Yahoo Finance</label>
        <input list="tk-l" value={form.ticker} placeholder="AAPL, BTC-USD, WLD.PA" onChange={e=>handleTickerChange(e.target.value)}/>
        <datalist id="tk-l">{known.map(t=><option key={t} value={t}/>)}</datalist></div>
      <div className="field" style={F}><label>Nom</label>
        <input value={form.nom} placeholder="Apple Inc." onChange={e=>s("nom",e.target.value)}/></div>
      <div className="field" style={F}><label>Sous-catégorie</label>
        <select value={form.sous_categorie??""} onChange={e=>s("sous_categorie",e.target.value)}>
          {SUBS_NO_ESPECES.map(sc=><option key={sc.key} value={sc.key}>{sc.label}</option>)}
        </select></div>
      <div className="field" style={F}><label>Quantité</label>
        <input type="number" step="0.0001" value={form.quantite} onChange={e=>s("quantite",parseFloat(e.target.value)||0)}/></div>
      <div className="field" style={F}>
        <label>Total commande (€) <span style={{color:"var(--text-2)",fontSize:9}}>montant global</span></label>
        <input type="number" step="0.01" value={totalCmd} onChange={e=>setTotalCmd(parseFloat(e.target.value)||0)}/>
        {prixUnitaire>0&&<div style={{fontSize:10,color:"var(--text-1)",marginTop:3}}>→ Prix unitaire : {prixUnitaire.toFixed(6)} €</div>}
      </div>
      <div className="field" style={F}><label>Date d'achat</label>
        <input type="date" value={form.date_achat} onChange={e=>s("date_achat",e.target.value)}/></div>
      <div className="field" style={S2}><label>Notes</label>
        <textarea rows={2} value={form.notes??""} onChange={e=>s("notes",e.target.value)}/></div>
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
  const { poches } = usePoches();
  const [form,setForm]=useState<Versement>({poche,montant:0,date:defaultDateForMonth(mois)});
  const s=(k:keyof Versement,v:string|number)=>setForm(f=>({...f,[k]:v}));
  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-title">Versement cash · {poches.find(p=>p.key===poche)?.label??poche}</div>
    <div style={G2}>
      <div className="field" style={F}><label>Montant (€)</label>
        <input type="number" step="0.01" value={form.montant} onChange={e=>s("montant",parseFloat(e.target.value)||0)}/></div>
      <div className="field" style={F}><label>Date</label>
        <input type="date" value={form.date} onChange={e=>s("date",e.target.value)}/></div>
      <div className="field" style={S2}><label>Notes</label>
        <textarea rows={2} value={form.notes??""} onChange={e=>s("notes",e.target.value)}/></div>
    </div>
    <div className="form-actions">
      <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" onClick={async()=>{await invoke("add_versement",{versement:form});onSave();}}>Enregistrer</button>
    </div>
  </div></div>);
}

// ── Sell Modal ─────────────────────────────────────────────────────────────────

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function computeAtSellDate(
  tickerPositions: Position[],
  tickerVentes: Vente[],
  dateStr: string,
): { qty: number; pru: number } {
  type Ev = { date: string; type: "buy"; qty: number; price: number } | { date: string; type: "sell"; qty: number };
  const events: Ev[] = [
    ...tickerPositions
      .filter(p => (p.date_achat ?? "") <= dateStr)
      .map(p => ({ date: p.date_achat ?? "", type: "buy" as const, qty: p.quantite, price: p.prix_achat })),
    ...tickerVentes
      .filter(v => (v.date_vente ?? "") < dateStr)
      .map(v => ({ date: v.date_vente ?? "", type: "sell" as const, qty: v.quantite })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  let q = 0, inv = 0;
  for (const ev of events) {
    if (ev.type === "buy") { q += ev.qty; inv += ev.qty * ev.price; }
    else { const pru = q > 0 ? inv / q : 0; q = Math.max(0, q - ev.qty); inv = Math.max(0, inv - ev.qty * pru); }
  }
  return { qty: q, pru: q > 0 ? inv / q : 0 };
}

export function SellModal({poche,ticker,nom,tickerPositions,tickerVentes,getPriceForDate,mois=curMonth,onClose,onSave}:{
  poche:string;ticker:string;nom:string;
  tickerPositions:Position[];tickerVentes:Vente[];
  getPriceForDate:(ticker:string,date:string,pru?:number)=>number;
  mois?:string;onClose:()=>void;onSave:()=>void;
}) {
  const {fmt}=useDevise();

  const minDate = useMemo(() => {
    const max = tickerVentes.reduce((m,v) => (v.date_vente??'') > m ? (v.date_vente??'') : m, '');
    return max ? addDays(max, 1) : '';
  }, [tickerVentes]);

  const clamp = (d: string) => (minDate && d < minDate) ? minDate : d;

  const [date, setDate] = useState(() => clamp(defaultDateForMonth(mois)));
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');

  const { qty: availQty, pru } = useMemo(
    () => computeAtSellDate(tickerPositions, tickerVentes, date),
    [tickerPositions, tickerVentes, date],
  );

  const priceAtDate = useMemo(
    () => availQty > 0 ? getPriceForDate(ticker, date, pru) : 0,
    [ticker, date, pru, availQty, getPriceForDate],
  );

  const [qty, setQty] = useState(availQty);
  const [totalVente, setTotalVente] = useState(parseFloat((priceAtDate * availQty).toFixed(2)));

  const prevDateRef = useRef(date);
  useEffect(() => {
    if (prevDateRef.current !== date) {
      prevDateRef.current = date;
      setQty(availQty);
      setTotalVente(parseFloat((priceAtDate * availQty).toFixed(2)));
    }
  }, [date, availQty, priceAtDate]);

  const prixUnitaire = qty > 0 ? totalVente / qty : 0;
  const estPnl = (prixUnitaire - pru) * qty;

  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="sell-header">
      <span className="sell-icon">📤</span>
      <div>
        <div className="modal-title" style={{marginBottom:2}}>Vendre · {ticker}</div>
        <div style={{color:"var(--text-1)",fontSize:12}}>{nom}</div>
      </div>
    </div>
    <div style={G2}>
      <div className="field" style={F}>
        <label>Date{minDate&&<span style={{color:"var(--text-2)",fontSize:9,marginLeft:4}}>min {minDate}</span>}</label>
        <input type="date" value={date} min={minDate||undefined} onChange={e=>setDate(clamp(e.target.value))}/>
      </div>
      <div className="field" style={F}>
        <label>Disponible à cette date</label>
        <div style={{...RO,color:availQty>0?"var(--text-0)":"var(--rose)"}}>
          {availQty > 0
            ? <>{availQty.toFixed(4)} parts · PRU <span style={{color:"var(--gold)"}}>{fmt(pru)}</span></>
            : "Aucune position à cette date"}
        </div>
      </div>
      <div className="field" style={F}>
        <label>Quantité (max {availQty.toFixed(4)})</label>
        <input type="number" step="0.0001" min="0.0001" max={availQty} value={qty} disabled={availQty<=0}
          onChange={e=>{const q=Math.min(parseFloat(e.target.value)||0,availQty);setQty(q);setTotalVente(parseFloat((priceAtDate*q).toFixed(2)));}}/>
      </div>
      <div className="field" style={F}>
        <label>Total vente (€) <span style={{color:"var(--text-2)",fontSize:9}}>montant global</span></label>
        <input type="number" step="0.01" value={totalVente} disabled={availQty<=0}
          onChange={e=>setTotalVente(parseFloat(e.target.value)||0)}/>
        {qty>0&&<div style={{fontSize:10,color:"var(--text-1)",marginTop:3}}>→ Prix unitaire : {prixUnitaire.toFixed(6)} €</div>}
      </div>
      <div className="field" style={F}>
        <label>PnL estimé</label>
        <div style={{...RO,color:estPnl>=0?"var(--teal)":"var(--rose)",fontSize:13}}>
          {estPnl>=0?"+":""}{fmt(estPnl)}
        </div>
      </div>
      <div className="field" style={F}><label>Notes</label>
        <textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/>
      </div>
    </div>
    {err&&<div style={{color:"var(--rose)",fontSize:12,marginBottom:12}}>⚠ {err}</div>}
    <div className="form-actions">
      <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-danger" disabled={availQty<=0||qty<=0} onClick={async()=>{
        setErr("");
        try{await invoke("sell_position",{poche,ticker,nom,quantiteVendue:qty,prixVente:prixUnitaire,dateVente:date,notes:notes||null});onSave();}
        catch(e:any){setErr(String(e));}
      }}>Confirmer</button>
    </div>
  </div></div>);
}

// ── Dividende Modal ────────────────────────────────────────────────────────────
const REINVEST_SUBCATS: readonly string[] = TRADEABLE_SUBCATS;

export function DividendeModal({poche,positions,mois=curMonth,onClose,onSave}:{
  poche:string;positions:Position[];mois?:string;onClose:()=>void;onSave:()=>void;
}) {
  const tickers=[...new Set(positions.map(p=>p.ticker))];
  const allOptions=[...tickers,"_INTERETS_"];
  const nomByTicker=Object.fromEntries(positions.map(p=>[p.ticker,p.nom]));
  const subcatByTicker=Object.fromEntries(positions.map(p=>[p.ticker,p.sous_categorie??""]));
  const [form,setForm]=useState<Dividende>({ticker:tickers[0]??"_INTERETS_",poche,montant:0,date:defaultDateForMonth(mois)});
  const [quantite,setQuantite]=useState<number>(0);
  const s=(k:keyof Dividende,v:string|number)=>setForm(f=>({...f,[k]:v}));

  const selectedNom=form.ticker==="_INTERETS_"?"Intérêts / Cash":(nomByTicker[form.ticker]??"");
  const selectedSubcat=subcatByTicker[form.ticker]??"";
  const isReinvest=REINVEST_SUBCATS.includes(selectedSubcat);
  const prixUnitaire=quantite>0?form.montant/quantite:0;

  const handleSave=async()=>{
    await invoke("add_dividende",{dividende:form});
    if(isReinvest&&quantite>0){
      await invoke("add_position",{position:{
        poche, ticker:form.ticker, nom:nomByTicker[form.ticker]??"",
        sous_categorie:selectedSubcat, quantite,
        prix_achat:prixUnitaire, date_achat:form.date, notes:"[REINVEST_DIV]",
      }});
    }
    onSave();
  };

  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-title">Ajouter un dividende / intérêt</div>
    <div style={G2}>
      <div className="field" style={F}><label>Ticker</label>
        <select value={form.ticker} onChange={e=>{s("ticker",e.target.value);setQuantite(0);}}>
          {allOptions.map(t=><option key={t} value={t}>{t==="_INTERETS_"?"Intérêts":t}</option>)}
        </select></div>
      <div className="field" style={F}><label>Nom</label>
        <input value={selectedNom} readOnly tabIndex={-1}
          style={{background:"var(--bg-2)",color:"var(--text-2)",cursor:"default"}}/></div>
      <div className="field" style={F}><label>Montant (€)</label>
        <input type="number" step="0.01" value={form.montant} onChange={e=>s("montant",parseFloat(e.target.value)||0)}/></div>
      <div className="field" style={F}><label>Date</label>
        <input type="date" value={form.date} onChange={e=>s("date",e.target.value)}/></div>
      {isReinvest&&<>
        <div className="field" style={F}><label>Quantité reçue (réinvesti)</label>
          <input type="number" step="any" min="0" value={quantite||""} placeholder="0"
            onChange={e=>setQuantite(parseFloat(e.target.value)||0)}/></div>
        <div className="field" style={F}><label>Prix unitaire calculé</label>
          <input value={quantite>0?`${prixUnitaire.toFixed(6)} €/unité`:"—"} readOnly tabIndex={-1}
            style={{background:"var(--bg-2)",color:"var(--text-2)",cursor:"default"}}/></div>
      </>}
      <div className="field" style={S2}><label>Notes</label>
        <textarea rows={2} value={form.notes??""} onChange={e=>s("notes",e.target.value)}/></div>
    </div>
    <div className="form-actions">
      <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" onClick={handleSave}>Enregistrer</button>
    </div>
  </div></div>);
}

// ── SCPI Valuation Modal ───────────────────────────────────────────────────────
export function ScpiValuationModal({scpiTickers,mois=curMonth,valuations,onClose,onSave}:{
  scpiTickers:string[];mois?:string;valuations:ScpiValuation[];onClose:()=>void;onSave:()=>void;
}) {
  const [ticker,setTicker]=useState(scpiTickers[0]??"");
  const [month,setMonth]=useState(mois);
  const [valeur,setValeur]=useState(0);

  const history=valuations.filter(v=>v.ticker===ticker).sort((a,b)=>b.mois.localeCompare(a.mois));

  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:600}}>
    <div className="modal-title">Valorisation SCPI</div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginTop:16}}>
      {/* ── Col gauche : saisie ── */}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div className="field" style={F}><label>Ticker SCPI</label>
          <select value={ticker} onChange={e=>setTicker(e.target.value)}>
            {scpiTickers.map(t=><option key={t} value={t}>{t}</option>)}
          </select></div>
        <div className="field" style={F}><label>Mois (YYYY-MM)</label>
          <input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></div>
        <div className="field" style={F}><label>Valeur unitaire (€)</label>
          <input type="number" step="0.01" value={valeur} onChange={e=>setValeur(parseFloat(e.target.value)||0)}/></div>
      </div>
      {/* ── Col droite : historique ── */}
      <div>
        <div style={{fontSize:10,color:"var(--text-2)",marginBottom:6,textTransform:"uppercase",letterSpacing:".08em"}}>
          Historique {ticker||"—"}
        </div>
        {history.length===0
          ? <div style={{fontSize:11,color:"var(--text-2)",padding:"8px 0"}}>Aucune valorisation</div>
          : <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:200,overflowY:"auto"}}>
              {history.map(v=>(
                <div key={v.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"4px 10px",background:"var(--bg-2)",borderRadius:6,fontSize:11}}>
                  <span style={{color:"var(--text-1)"}}>{v.mois}</span>
                  <span style={{color:"var(--gold)",fontWeight:500}}>{v.valeur_unit.toFixed(2)} €</span>
                  <button className="btn btn-ghost btn-sm" style={{fontSize:10,padding:"2px 8px",color:"var(--rose)"}}
                    onClick={async()=>{await invoke("delete_scpi_valuation",{id:v.id});onSave();}}>✕</button>
                </div>
              ))}
            </div>}
      </div>
    </div>
    <div className="form-actions">
      <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
      <button className="btn btn-primary" disabled={!ticker||valeur<=0}
        onClick={async()=>{await invoke("add_scpi_valuation",{val:{ticker,mois:month,valeur_unit:valeur}});onSave();}}>Enregistrer</button>
    </div>
  </div></div>);
}

// ── Trade Modal ────────────────────────────────────────────────────────────────

export function TradeModal({poche,ticker,nom,subcat:_subcat,tickerPositions,tickerVentes,tradeablePositions,getPriceForDate:_gpfd,mois=curMonth,onClose,onSave}:{
  poche:string;ticker:string;nom:string;subcat:string;
  tickerPositions:Position[];tickerVentes:Vente[];
  tradeablePositions:Position[];
  getPriceForDate:(ticker:string,date:string,pru?:number)=>number;
  mois?:string;onClose:()=>void;onSave:()=>void;
}) {
  const {fmt}=useDevise();

  const minDate=useMemo(()=>{
    const max=tickerVentes.reduce((m,v)=>(v.date_vente??'')>m?(v.date_vente??''):m,'');
    return max?addDays(max,1):'';
  },[tickerVentes]);
  const clamp=(d:string)=>(minDate&&d<minDate)?minDate:d;

  const [date,setDate]=useState(()=>clamp(defaultDateForMonth(mois)));
  const [err,setErr]=useState('');
  const [notes,setNotes]=useState('');

  const {qty:availQty,pru:pruSource}=useMemo(
    ()=>computeAtSellDate(tickerPositions,tickerVentes,date),
    [tickerPositions,tickerVentes,date],
  );

  const [qtyToTrade,setQtyToTrade]=useState(availQty);
  const prevDateRef=useRef(date);
  useEffect(()=>{
    if(prevDateRef.current!==date){prevDateRef.current=date;setQtyToTrade(availQty);}
  },[date,availQty]);

  const costBasis=qtyToTrade*pruSource;

  const destTickers=useMemo(()=>{
    const seen=new Set<string>();
    const out:{ticker:string;nom:string;subcat:string}[]=[];
    for(const p of tradeablePositions){
      if(p.ticker!==ticker&&!seen.has(p.ticker)){
        seen.add(p.ticker);
        out.push({ticker:p.ticker,nom:p.nom,subcat:p.sous_categorie??''});
      }
    }
    return out;
  },[tradeablePositions,ticker]);

  const NEW_KEY="__NEW__";
  const [destSel,setDestSel]=useState(()=>destTickers[0]?.ticker??NEW_KEY);
  const [newTicker,setNewTicker]=useState('');
  const [newNom,setNewNom]=useState('');
  const [newSubcat,setNewSubcat]=useState<string>(INVEST_SUBCATS[0].key);

  const isNew=destSel===NEW_KEY;
  const destTicker=isNew?newTicker.toUpperCase():destSel;
  const destNom=isNew?newNom:(destTickers.find(t=>t.ticker===destSel)?.nom??'');
  const destSubcat=isNew?newSubcat:(destTickers.find(t=>t.ticker===destSel)?.subcat??'');

  const [qtyDest,setQtyDest]=useState('');
  const qtyDestNum=parseFloat(qtyDest)||0;
  const destPru=qtyDestNum>0?costBasis/qtyDestNum:0;
  const canConfirm=availQty>0&&qtyToTrade>0&&destTicker.length>0&&qtyDestNum>0;

  const COL: React.CSSProperties = {
    display:"flex",flexDirection:"column",gap:10,padding:"14px 16px",
    background:"var(--bg-2)",borderRadius:8,border:"1px solid var(--border)",
  };
  const LBL: React.CSSProperties = {
    fontSize:10,color:"var(--text-2)",textTransform:"uppercase",
    letterSpacing:".08em",fontWeight:600,marginBottom:2,
  };

  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:680}}>
    <div className="sell-header">
      <span className="sell-icon">🔄</span>
      <div>
        <div className="modal-title" style={{marginBottom:2}}>Trader · {ticker}</div>
        <div style={{color:"var(--text-1)",fontSize:12}}>{nom}</div>
      </div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginTop:12}}>
      {/* ── Source ── */}
      <div style={COL}>
        <div style={LBL}>Source — {ticker}</div>
        <div className="field" style={F}>
          <label>Date{minDate&&<span style={{color:"var(--text-2)",fontSize:9,marginLeft:4}}>min {minDate}</span>}</label>
          <input type="date" value={date} min={minDate||undefined} onChange={e=>setDate(clamp(e.target.value))}/>
        </div>
        <div className="field" style={F}>
          <label>Disponible à cette date</label>
          <div style={{...RO,color:availQty>0?"var(--text-0)":"var(--rose)"}}>
            {availQty>0?<>{availQty.toFixed(4)} parts · PRU <span style={{color:"var(--gold)"}}>{fmt(pruSource)}</span></>:"Aucune position à cette date"}
          </div>
        </div>
        <div className="field" style={F}>
          <label>Quantité à trader (max {availQty.toFixed(4)})</label>
          <input type="number" step="0.0001" min="0.0001" max={availQty} value={qtyToTrade} disabled={availQty<=0}
            onChange={e=>setQtyToTrade(Math.min(parseFloat(e.target.value)||0,availQty))}/>
        </div>
        <div className="field" style={F}>
          <label>Base de coût transférée</label>
          <div style={{...RO,color:"var(--gold)",fontSize:13}}>{fmt(costBasis)}</div>
        </div>
      </div>

      {/* ── Destination ── */}
      <div style={COL}>
        <div style={LBL}>Destination</div>
        <div className="field" style={F}>
          <label>Ticker destination</label>
          <select value={destSel} onChange={e=>setDestSel(e.target.value)}>
            {destTickers.map(t=><option key={t.ticker} value={t.ticker}>{t.ticker} — {t.nom}</option>)}
            <option value={NEW_KEY}>+ Nouveau ticker…</option>
          </select>
        </div>
        {isNew&&<>
          <div className="field" style={F}><label>Ticker</label>
            <input value={newTicker} placeholder="BTC-USD" onChange={e=>setNewTicker(e.target.value.toUpperCase())}/></div>
          <div className="field" style={F}><label>Nom</label>
            <input value={newNom} placeholder="Bitcoin" onChange={e=>setNewNom(e.target.value)}/></div>
          <div className="field" style={F}><label>Sous-catégorie</label>
            <select value={newSubcat} onChange={e=>setNewSubcat(e.target.value)}>
              {INVEST_SUBCATS.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
            </select></div>
        </>}
        <div className="field" style={F}>
          <label>Quantité reçue</label>
          <input type="number" step="0.00000001" min="0.00000001" value={qtyDest} disabled={availQty<=0}
            onChange={e=>setQtyDest(e.target.value)}/>
        </div>
        <div className="field" style={F}>
          <label>PRU calculé</label>
          <div style={{...RO,color:"var(--teal)",fontSize:13}}>{qtyDestNum>0?fmt(destPru):"—"}</div>
        </div>
      </div>
    </div>

    <div className="field" style={{margin:"14px 0 0"}}>
      <label>Notes</label>
      <textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/>
    </div>

    {err&&<div style={{color:"var(--rose)",fontSize:12,marginBottom:12}}>⚠ {err}</div>}
    <div className="form-actions">
      <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={!canConfirm} onClick={async()=>{
        setErr("");
        const sfx=notes?` ${notes}`:"";
        try{
          await invoke("sell_position",{poche,ticker,nom,quantiteVendue:qtyToTrade,prixVente:pruSource,
            dateVente:date,notes:`[TRADE → ${destTicker}]${sfx}`});
          await invoke("add_position",{position:{poche,ticker:destTicker,nom:destNom,sous_categorie:destSubcat,
            quantite:qtyDestNum,prix_achat:destPru,date_achat:date,notes:`[TRADE ← ${ticker}]${sfx}`}});
          onSave();
        }catch(e:any){setErr(String(e));}
      }}>Confirmer le trade</button>
    </div>
  </div></div>);
}
