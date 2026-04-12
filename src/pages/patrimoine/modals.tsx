import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { LIVRETS_DEF, POCHES, INVEST_SUBCATS, TRADEABLE_SUBCATS, defaultDateForMonth } from "../../constants";
import { curMonth } from "../../context/DeviseContext";
import { useDevise } from "../../context/DeviseContext";
import type { Livret, Position, Vente, Dividende, Versement, ScpiValuation } from "./types";

// ── Livret Modal ───────────────────────────────────────────────────────────────
export function LivretModal({mois,onClose,onSave}:{mois:string;onClose:()=>void;onSave:()=>void}) {
  const [form,setForm]=useState<Livret>({poche:LIVRETS_DEF[0].key,montant:0,taux:LIVRETS_DEF[0].taux,date:defaultDateForMonth(mois)});
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
          <span style={{fontSize:12}}>{r.date_achat} — {r.quantite.toFixed(8)} × {r.prix_achat.toFixed(6)} € = {(r.quantite*r.prix_achat).toFixed(2)} €</span>
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

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Replay all buy/sell events for a ticker chronologically up to dateStr
// to get remaining quantity and PRU at that date.
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

  // Min selectable date = day after the most recent existing vente for this ticker
  const minDate = useMemo(() => {
    const max = tickerVentes.reduce((m,v) => (v.date_vente??'') > m ? (v.date_vente??'') : m, '');
    return max ? addDays(max, 1) : '';
  }, [tickerVentes]);

  const clamp = (d: string) => (minDate && d < minDate) ? minDate : d;

  const [date, setDate] = useState(() => clamp(defaultDateForMonth(mois)));
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');

  // Qty available and PRU at the selected date (chronological replay)
  const { qty: availQty, pru } = useMemo(
    () => computeAtSellDate(tickerPositions, tickerVentes, date),
    [tickerPositions, tickerVentes, date],
  );

  // Estimated price at selected date (falls back to PRU if quote unavailable)
  const priceAtDate = useMemo(
    () => availQty > 0 ? getPriceForDate(ticker, date, pru) : 0,
    [ticker, date, pru, availQty, getPriceForDate],
  );

  const [qty, setQty] = useState(availQty);
  const [totalVente, setTotalVente] = useState(parseFloat((priceAtDate * availQty).toFixed(2)));

  // When date changes → reset qty to max available and totalVente to estimated
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
    <div className="form-grid">
      <div className="field">
        <label>Date{minDate&&<span style={{color:"var(--text-2)",fontSize:9,marginLeft:4}}>min {minDate}</span>}</label>
        <input type="date" value={date} min={minDate||undefined}
          onChange={e=>setDate(clamp(e.target.value))}/>
      </div>
      <div className="field">
        <label>Disponible à cette date</label>
        <div style={{padding:"8px 11px",borderRadius:6,border:"1px solid var(--border-l)",background:"var(--bg-0)",
          color:availQty>0?"var(--text-0)":"var(--rose)",fontSize:12,fontFamily:availQty>0?"var(--mono)":undefined}}>
          {availQty > 0
            ? <>{availQty.toFixed(4)} parts · PRU <span style={{color:"var(--gold)"}}>{fmt(pru)}</span></>
            : "Aucune position à cette date"}
        </div>
      </div>
      <div className="field">
        <label>Quantité (max {availQty.toFixed(4)})</label>
        <input type="number" step="0.0001" min="0.0001" max={availQty} value={qty} disabled={availQty<=0}
          onChange={e=>{const q=Math.min(parseFloat(e.target.value)||0,availQty);setQty(q);setTotalVente(parseFloat((priceAtDate*q).toFixed(2)));}}/>
      </div>
      <div className="field">
        <label>Total vente (€) <span style={{color:"var(--text-2)",fontSize:9}}>montant global</span></label>
        <input type="number" step="0.01" value={totalVente} disabled={availQty<=0}
          onChange={e=>setTotalVente(parseFloat(e.target.value)||0)}/>
        {qty>0&&<div style={{fontSize:10,color:"var(--text-1)",marginTop:3}}>→ Prix unitaire : {prixUnitaire.toFixed(6)} €</div>}
      </div>
      <div className="field">
        <label>PnL estimé</label>
        <div style={{padding:"8px 11px",borderRadius:6,border:"1px solid var(--border-l)",background:"var(--bg-0)",
          color:estPnl>=0?"var(--teal)":"var(--rose)",fontSize:13}}>
          {estPnl>=0?"+":""}{fmt(estPnl)}
        </div>
      </div>
      <div className="field"><label>Notes</label><textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/></div>
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
export function DividendeModal({poche,positions,mois=curMonth,onClose,onSave}:{
  poche:string;positions:Position[];mois?:string;onClose:()=>void;onSave:()=>void;
}) {
  const tickers=[...new Set(positions.map(p=>p.ticker))];
  const allOptions=[...tickers,"_INTERETS_"];
  const nomByTicker=Object.fromEntries(positions.map(p=>[p.ticker,p.nom]));
  const [form,setForm]=useState<Dividende>({ticker:tickers[0]??"_INTERETS_",poche,montant:0,date:defaultDateForMonth(mois)});
  const s=(k:keyof Dividende,v:string|number)=>setForm(f=>({...f,[k]:v}));
  const selectedNom=form.ticker==="_INTERETS_"?"Intérêts / Cash":(nomByTicker[form.ticker]??"");
  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-title">Ajouter un dividende / intérêt</div>
    <div className="form-grid">
      <div className="field"><label>Ticker</label>
        <select value={form.ticker} onChange={e=>s("ticker",e.target.value)}>
          {allOptions.map(t=><option key={t} value={t}>{t==="_INTERETS_"?"Intérêts":t}</option>)}
        </select></div>
      <div className="field"><label>Nom</label>
        <input value={selectedNom} readOnly tabIndex={-1}
          style={{background:"var(--bg-2)",color:"var(--text-2)",cursor:"default"}}/>
      </div>
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

// ── SCPI Valuation Modal ───────────────────────────────────────────────────────
export function ScpiValuationModal({poche,scpiTickers,mois=curMonth,valuations,onClose,onSave}:{
  poche:string;scpiTickers:string[];mois?:string;valuations:ScpiValuation[];onClose:()=>void;onSave:()=>void;
}) {
  const [ticker,setTicker]=useState(scpiTickers[0]??"");
  const [month,setMonth]=useState(mois);
  const [valeur,setValeur]=useState(0);
  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="modal-title">Valorisation SCPI · {POCHES.find(p=>p.key===poche)?.label}</div>
    <div className="form-grid">
      <div className="field"><label>Ticker SCPI</label>
        <select value={ticker} onChange={e=>setTicker(e.target.value)}>
          {scpiTickers.map(t=><option key={t} value={t}>{t}</option>)}
        </select></div>
      <div className="field"><label>Mois (YYYY-MM)</label>
        <input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></div>
      <div className="field"><label>Valeur unitaire (€)</label>
        <input type="number" step="0.01" value={valeur} onChange={e=>setValeur(parseFloat(e.target.value)||0)}/></div>
    </div>
    {valuations.filter(v=>v.ticker===ticker).length>0&&(
      <div style={{marginBottom:16}}>
        <div style={{fontSize:10,color:"var(--text-2)",marginBottom:6,textTransform:"uppercase",letterSpacing:".08em"}}>Historique {ticker}</div>
        <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:160,overflowY:"auto"}}>
          {valuations.filter(v=>v.ticker===ticker).sort((a,b)=>b.mois.localeCompare(a.mois)).map(v=>(
            <div key={v.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
              padding:"4px 10px",background:"var(--bg-2)",borderRadius:6,fontSize:11}}>
              <span style={{color:"var(--text-1)"}}>{v.mois}</span>
              <span style={{color:"var(--gold)",fontWeight:500}}>{v.valeur_unit.toFixed(2)} €</span>
              <button className="btn btn-ghost btn-sm" style={{fontSize:10,padding:"2px 8px",color:"var(--rose)"}}
                onClick={async()=>{await invoke("delete_scpi_valuation",{id:v.id});onSave();}}>✕</button>
            </div>
          ))}
        </div>
      </div>
    )}
    <div className="form-actions">
      <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
      <button className="btn btn-primary" disabled={!ticker||valeur<=0}
        onClick={async()=>{await invoke("add_scpi_valuation",{val:{poche,ticker,mois:month,valeur_unit:valeur}});onSave();}}>Enregistrer</button>
    </div>
  </div></div>);
}

// ── Trade Modal — swap partiel/total sans PnL réalisé ─────────────────────────

const TRADEABLE_SUBCAT_KEYS: readonly string[] = TRADEABLE_SUBCATS;

export function TradeModal({poche,ticker,nom,subcat:_subcat,tickerPositions,tickerVentes,tradeablePositions,getPriceForDate:_gpfd,mois=curMonth,onClose,onSave}:{
  poche:string;ticker:string;nom:string;subcat:string;
  tickerPositions:Position[];tickerVentes:Vente[];
  tradeablePositions:Position[];
  getPriceForDate:(ticker:string,date:string,pru?:number)=>number;
  mois?:string;onClose:()=>void;onSave:()=>void;
}) {
  const {fmt}=useDevise();

  // Min date = day after most recent vente for this source ticker
  const minDate=useMemo(()=>{
    const max=tickerVentes.reduce((m,v)=>(v.date_vente??'')>m?(v.date_vente??''):m,'');
    return max?addDays(max,1):'';
  },[tickerVentes]);
  const clamp=(d:string)=>(minDate&&d<minDate)?minDate:d;

  const [date,setDate]=useState(()=>clamp(defaultDateForMonth(mois)));
  const [err,setErr]=useState('');
  const [notes,setNotes]=useState('');

  // Source: available qty + PRU at selected date
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

  // Distinct destination tickers (tradeable, excluding source)
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
  const [newSubcat,setNewSubcat]=useState<string>(TRADEABLE_SUBCATS[0]);

  const isNew=destSel===NEW_KEY;
  const destTicker=isNew?newTicker.toUpperCase():destSel;
  const destNom=isNew?newNom:(destTickers.find(t=>t.ticker===destSel)?.nom??'');
  const destSubcat=isNew?newSubcat:(destTickers.find(t=>t.ticker===destSel)?.subcat??'');

  const [qtyDest,setQtyDest]=useState('');
  const qtyDestNum=parseFloat(qtyDest)||0;
  const destPru=qtyDestNum>0?costBasis/qtyDestNum:0;

  const canConfirm=availQty>0&&qtyToTrade>0&&destTicker.length>0&&qtyDestNum>0;

  return(<div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}>
    <div className="sell-header">
      <span className="sell-icon">🔄</span>
      <div>
        <div className="modal-title" style={{marginBottom:2}}>Trader · {ticker}</div>
        <div style={{color:"var(--text-1)",fontSize:12}}>{nom}</div>
      </div>
    </div>

    <div style={{fontSize:10,color:"var(--text-2)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Source</div>
    <div className="form-grid">
      <div className="field">
        <label>Date{minDate&&<span style={{color:"var(--text-2)",fontSize:9,marginLeft:4}}>min {minDate}</span>}</label>
        <input type="date" value={date} min={minDate||undefined} onChange={e=>setDate(clamp(e.target.value))}/>
      </div>
      <div className="field">
        <label>Disponible à cette date</label>
        <div style={{padding:"8px 11px",borderRadius:6,border:"1px solid var(--border-l)",background:"var(--bg-0)",
          color:availQty>0?"var(--text-0)":"var(--rose)",fontSize:12,fontFamily:availQty>0?"var(--mono)":undefined}}>
          {availQty>0?<>{availQty.toFixed(4)} parts · PRU <span style={{color:"var(--gold)"}}>{fmt(pruSource)}</span></>:"Aucune position à cette date"}
        </div>
      </div>
      <div className="field">
        <label>Quantité à trader (max {availQty.toFixed(4)})</label>
        <input type="number" step="0.0001" min="0.0001" max={availQty} value={qtyToTrade} disabled={availQty<=0}
          onChange={e=>setQtyToTrade(Math.min(parseFloat(e.target.value)||0,availQty))}/>
      </div>
      <div className="field">
        <label>Base de coût transférée</label>
        <div style={{padding:"8px 11px",borderRadius:6,border:"1px solid var(--border-l)",background:"var(--bg-0)",
          fontSize:13,color:"var(--gold)",fontFamily:"var(--mono)"}}>
          {fmt(costBasis)}
        </div>
      </div>
    </div>

    <div style={{fontSize:10,color:"var(--text-2)",textTransform:"uppercase",letterSpacing:".08em",margin:"12px 0 6px"}}>Destination</div>
    <div className="form-grid">
      <div className="field span2">
        <label>Ticker destination</label>
        <select value={destSel} onChange={e=>setDestSel(e.target.value)}>
          {destTickers.map(t=><option key={t.ticker} value={t.ticker}>{t.ticker} — {t.nom}</option>)}
          <option value={NEW_KEY}>+ Nouveau ticker…</option>
        </select>
      </div>
      {isNew&&<>
        <div className="field"><label>Ticker</label>
          <input value={newTicker} placeholder="BTC-USD" onChange={e=>setNewTicker(e.target.value.toUpperCase())}/>
        </div>
        <div className="field"><label>Nom</label>
          <input value={newNom} placeholder="Bitcoin" onChange={e=>setNewNom(e.target.value)}/>
        </div>
        <div className="field span2"><label>Sous-catégorie</label>
          <select value={newSubcat} onChange={e=>setNewSubcat(e.target.value)}>
            {INVEST_SUBCATS.filter(s=>TRADEABLE_SUBCAT_KEYS.includes(s.key)).map(s=>
              <option key={s.key} value={s.key}>{s.label}</option>
            )}
          </select>
        </div>
      </>}
      <div className="field">
        <label>Quantité reçue</label>
        <input type="number" step="0.00000001" min="0.00000001" value={qtyDest} disabled={availQty<=0}
          onChange={e=>setQtyDest(e.target.value)}/>
      </div>
      <div className="field">
        <label>PRU calculé</label>
        <div style={{padding:"8px 11px",borderRadius:6,border:"1px solid var(--border-l)",background:"var(--bg-0)",
          fontSize:13,color:"var(--teal)",fontFamily:"var(--mono)"}}>
          {qtyDestNum>0?fmt(destPru):"—"}
        </div>
      </div>
      <div className="field span2"><label>Notes</label><textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/></div>
    </div>

    {err&&<div style={{color:"var(--rose)",fontSize:12,marginBottom:12}}>⚠ {err}</div>}
    <div className="form-actions">
      <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={!canConfirm} onClick={async()=>{
        setErr("");
        const notesSuffix=notes?` ${notes}`:"";
        try{
          // 1. Retirer la source à son PRU → PnL = 0
          await invoke("sell_position",{
            poche,ticker,nom,quantiteVendue:qtyToTrade,prixVente:pruSource,
            dateVente:date,notes:`[TRADE → ${destTicker}]${notesSuffix}`,
          });
          // 2. Ajouter la destination avec la base de coût transférée
          await invoke("add_position",{position:{
            poche,ticker:destTicker,nom:destNom,sous_categorie:destSubcat,
            quantite:qtyDestNum,prix_achat:destPru,date_achat:date,
            notes:`[TRADE ← ${ticker}]${notesSuffix}`,
          }});
          onSave();
        }catch(e:any){setErr(String(e));}
      }}>Confirmer le trade</button>
    </div>
  </div></div>);
}
