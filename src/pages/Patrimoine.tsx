// ── Patrimoine page — main entry point ───────────────────────────────────────
// Split into:
//  src/pages/patrimoine/types.ts       — interfaces
//  src/pages/patrimoine/shared.tsx     — ChartGrid, NestedPie, Boundary, AccordionSection
//  src/pages/patrimoine/modals.tsx     — all modals
//  src/pages/patrimoine/LivretsSection.tsx
//  src/pages/patrimoine/PocheSection.tsx
import { useEffect, useState, useMemo, useCallback, Component, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip,
} from "recharts";
import { useDevise, MONTHS, curMonth } from "../context/DeviseContext";
import { useQuotes } from "../hooks/useQuotes";
import {
  LIVRETS_DEF, POCHES, INVEST_SUBCATS, INVEST_SUBCAT_COLOR, POCHE_COLOR,
  TOOLTIP_STYLE, monthsBetween, tickerColor,
} from "../constants";
import MonthSelector from "../components/MonthSelector";
import { Boundary, ChartGrid, NestedPie, TTP } from "./patrimoine/shared";
import { LivretsSection } from "./patrimoine/LivretsSection";
import { PocheSection } from "./patrimoine/PocheSection";
import type { Livret, Position, Vente, Dividende, Versement } from "./patrimoine/types";

// ── Recap Investissement ───────────────────────────────────────────────────────
function RecapInvestissement({positions,ventes,mois}:{positions:Position[];ventes:Vente[];mois:string}) {
  const {fmt}=useDevise();
  const [pieToggle,setPieToggle]=useState<"capital"|"valeur">("capital");
  const tickers=useMemo(()=>[...new Set(positions.map(p=>p.ticker))],[positions]);
  const fromMonth=useMemo(()=>{
    const d=positions.map(p=>(p.date_achat??"").slice(0,7)).filter(Boolean).sort();
    return d[0]??curMonth;
  },[positions]);
  const {quotes,getPrice}=useQuotes(tickers,fromMonth);

  const pocheMap:Record<string,{value:number;color:string}>={};
  const subcatMap:Record<string,{value:number;color:string}>={};
  POCHES.forEach(p=>{
    const byT:Record<string,{q:number;inv:number;subcat:string}>={};
    positions.filter(pos=>pos.poche===p.key&&(pos.date_achat??"").slice(0,7)<=mois).forEach(pos=>{
      if(!byT[pos.ticker])byT[pos.ticker]={q:0,inv:0,subcat:pos.sous_categorie??"actions"};
      byT[pos.ticker].q+=pos.quantite;byT[pos.ticker].inv+=pos.quantite*pos.prix_achat;
    });
    ventes.filter(v=>v.poche===p.key&&(v.date_vente??"").slice(0,7)<=mois).forEach(v=>{
      if(byT[v.ticker]){byT[v.ticker].q=Math.max(0,byT[v.ticker].q-v.quantite);}
    });
    Object.entries(byT).forEach(([ticker,d])=>{
      if(d.q<=1e-9)return;
      const pru=d.q>0?d.inv/d.q:0;
      const val=pieToggle==="capital"?d.inv:(d.q*(getPrice(ticker,mois,pru)));
      if(!pocheMap[p.key])pocheMap[p.key]={value:0,color:p.color};
      pocheMap[p.key].value+=val;
      if(!subcatMap[d.subcat])subcatMap[d.subcat]={value:0,color:INVEST_SUBCAT_COLOR[d.subcat]??p.color};
      subcatMap[d.subcat].value+=val;
    });
  });
  const inner=Object.entries(pocheMap).map(([k,v])=>({name:POCHES.find(p=>p.key===k)?.label??k,...v}));
  const outer=Object.entries(subcatMap).map(([k,v])=>({name:INVEST_SUBCATS.find(s=>s.key===k)?.label??k,...v}));
  const grandTotal=Object.values(pocheMap).reduce((s,v)=>s+v.value,0);

  const allDates=positions.map(p=>(p.date_achat??"").slice(0,7)).filter(Boolean).sort();
  const firstMonth=allDates[0]??curMonth;
  const stackMonths=useMemo(()=>monthsBetween(firstMonth,curMonth),[firstMonth]);
  const stackedData=useMemo(()=>stackMonths.map(m=>{
    const entry:any={mois:m};
    POCHES.forEach(p=>{
      const byT:Record<string,{q:number;inv:number}>={};
      positions.filter(pos=>pos.poche===p.key&&(pos.date_achat??"").slice(0,7)<=m).forEach(pos=>{
        if(!byT[pos.ticker])byT[pos.ticker]={q:0,inv:0};
        byT[pos.ticker].q+=pos.quantite;byT[pos.ticker].inv+=pos.quantite*pos.prix_achat;
      });
      ventes.filter(v=>v.poche===p.key&&(v.date_vente??"").slice(0,7)<=m).forEach(v=>{
        if(byT[v.ticker]){const pru=byT[v.ticker].q>0?byT[v.ticker].inv/byT[v.ticker].q:0;byT[v.ticker].q=Math.max(0,byT[v.ticker].q-v.quantite);byT[v.ticker].inv=Math.max(0,byT[v.ticker].inv-v.quantite*pru);}
      });
      entry[p.label]=Object.entries(byT).reduce((s,[t,d])=>s+d.q*getPrice(t,m,d.q>0?d.inv/d.q:0),0);
    });
    return entry;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }),[stackMonths,positions,ventes,getPrice]);

  const pieNode=(h:number)=>inner.length===0?<div className="empty">Aucune donnée</div>:(
    <NestedPie inner={inner} outer={outer} total={grandTotal} fmt={fmt} h={h}
      toggleLabel={pieToggle==="capital"?"→ Valeur":"→ Capital"}
      onToggle={()=>setPieToggle(v=>v==="capital"?"valeur":"capital")}/>
  );
  const stackNode=(h:number)=>stackedData.length===0?<div className="empty">Aucune donnée</div>:(
    <ResponsiveContainer width="100%" height={h}>
      <AreaChart data={stackedData} margin={{left:-20}}>
        <defs>{POCHES.map(p=>(<linearGradient key={p.key} id={`gr_${p.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={p.color} stopOpacity={.7}/><stop offset="95%" stopColor={p.color} stopOpacity={.05}/></linearGradient>))}</defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
        <XAxis dataKey="mois" tick={{fontSize:8,fontFamily:"JetBrains Mono"}} interval={Math.max(0,Math.floor(stackedData.length/6)-1)}/>
        <YAxis tick={{fontSize:8,fontFamily:"JetBrains Mono"}} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k€`:`${v}€`} width={45}/>
        <Tooltip {...TTP} formatter={(v:number,n:string)=>[fmt(v),n]}/>
        <ReferenceLine x={mois} stroke="var(--gold)" strokeDasharray="4 2" label={{value:"◀",position:"insideTopRight",fill:"var(--gold)",fontSize:9}}/>
        {POCHES.map(p=><Area key={p.key} type="monotone" dataKey={p.label} stackId="r" stroke={p.color} strokeWidth={1.5} fill={`url(#gr_${p.key})`}/>)}
      </AreaChart>
    </ResponsiveContainer>
  );
  return(<div>
    <div className="section-sep"><span className="section-sep-label">Récap. investissements</span><div className="section-sep-line"/></div>
    <ChartGrid charts={[
      {key:"recap_pie",   title:`Poche / Sous-catégorie · ${mois}`, node:pieNode},
      {key:"recap_stack", title:"Valeur par poche / mois",           node:stackNode},
    ]}/>
  </div>);
}

// ── Global Recap ───────────────────────────────────────────────────────────────
function GlobalRecap({livrets,positions,ventes,mois}:{livrets:Livret[];positions:Position[];ventes:Vente[];mois:string}) {
  const {fmt}=useDevise();
  const isInteret=(l:Livret)=>(l.notes??"").startsWith("[INTERET");
  const latestLiv:Record<string,Livret>={};
  livrets.filter(l=>!isInteret(l)&&(l.date??"").slice(0,7)<=mois)
    .forEach(l=>{if(!latestLiv[l.poche]||l.date>latestLiv[l.poche].date)latestLiv[l.poche]=l;});
  const totalLivrets=Object.values(latestLiv).reduce((s,l)=>s+l.montant,0);
  const totalInvest=positions.filter(p=>(p.date_achat??"").slice(0,7)<=mois).reduce((s,p)=>s+p.quantite*p.prix_achat,0);

  const inner=[
    {name:"Livrets",value:totalLivrets,color:"#e6a817"},
    {name:"Investissements",value:totalInvest,color:"#3a7bd5"},
  ].filter(p=>p.value>0);
  const outer=[
    ...LIVRETS_DEF.map(l=>({name:l.label,value:latestLiv[l.key]?.montant??0,color:l.color+"cc"})),
    ...POCHES.map(p=>{
      const val=positions.filter(pos=>pos.poche===p.key&&(pos.date_achat??"").slice(0,7)<=mois).reduce((s,pos)=>s+pos.quantite*pos.prix_achat,0);
      return{name:p.label,value:val,color:p.color+"cc"};
    }),
  ].filter(p=>p.value>0);
  const grandTotal=totalLivrets+totalInvest;

  const allDates=[
    ...livrets.filter(l=>!isInteret(l)).map(l=>(l.date??"").slice(0,7)),
    ...positions.map(p=>(p.date_achat??"").slice(0,7)),
  ].filter(Boolean).sort();
  const firstMonth=allDates[0]??curMonth;
  const evoMonths=useMemo(()=>monthsBetween(firstMonth,curMonth),[firstMonth]);
  // All tickers for GlobalRecap price lookup
  const allTickersGlobal=useMemo(()=>[...new Set(positions.map(p=>p.ticker))],[positions]);
  const fromMonthGlobal=useMemo(()=>{
    const ds=[...livrets.filter(l=>!isInteret(l)).map(l=>(l.date??"").slice(0,7)),...positions.map(p=>(p.date_achat??"").slice(0,7))].filter(Boolean).sort();
    return ds[0]??curMonth;
  },[livrets,positions]);
  const {getPrice:getPriceGlobal}=useQuotes(allTickersGlobal,fromMonthGlobal);

  const evoData=useMemo(()=>evoMonths.map(m=>{
    const snap:Record<string,Livret>={};
    livrets.filter(l=>!isInteret(l)&&(l.date??"").slice(0,7)<=m).forEach(l=>{if(!snap[l.poche]||l.date>snap[l.poche].date)snap[l.poche]=l;});
    const livTotal=Object.values(snap).reduce((s,l)=>s+l.montant,0);
    // Portfolio value using market prices
    const byT:Record<string,{q:number;inv:number}>={};
    positions.filter(p=>(p.date_achat??"").slice(0,7)<=m).forEach(p=>{
      if(!byT[p.ticker])byT[p.ticker]={q:0,inv:0};
      byT[p.ticker].q+=p.quantite;byT[p.ticker].inv+=p.quantite*p.prix_achat;
    });
    ventes.filter(v=>(v.date_vente??"").slice(0,7)<=m).forEach(v=>{
      if(byT[v.ticker]){const pru=byT[v.ticker].q>0?byT[v.ticker].inv/byT[v.ticker].q:0;byT[v.ticker].q=Math.max(0,byT[v.ticker].q-v.quantite);byT[v.ticker].inv=Math.max(0,byT[v.ticker].inv-v.quantite*pru);if(byT[v.ticker].q<=1e-9)delete byT[v.ticker];}
    });
    const invTotal=Object.entries(byT).reduce((s,[t,d])=>s+d.q*getPriceGlobal(t,m,d.q>0?d.inv/d.q:0),0);
    return{mois:m,Livrets:livTotal,Investissements:invTotal};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }),[evoMonths,livrets,positions,ventes,getPriceGlobal]);

  const pieNode=(h:number)=>inner.length===0?<div className="empty">Aucune donnée</div>:(
    <NestedPie inner={inner} outer={outer} total={grandTotal} fmt={fmt} h={h} toggleLabel="Capital" onToggle={()=>{}}/>
  );
  const stackNode=(h:number)=>evoData.length===0?<div className="empty">Aucune donnée</div>:(
    <ResponsiveContainer width="100%" height={h}>
      <AreaChart data={evoData}>
        <defs>
          <linearGradient id="gGL4" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#e6a817" stopOpacity={.7}/><stop offset="95%" stopColor="#e6a817" stopOpacity={.05}/></linearGradient>
          <linearGradient id="gGI4" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3a7bd5" stopOpacity={.7}/><stop offset="95%" stopColor="#3a7bd5" stopOpacity={.05}/></linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
        <XAxis dataKey="mois" tick={{fontSize:8,fontFamily:"JetBrains Mono"}} interval={Math.max(0,Math.floor(evoData.length/7)-1)}/>
        <YAxis tick={{fontSize:8,fontFamily:"JetBrains Mono"}} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k€`:`${v}€`} width={45}/>
        <Tooltip {...TTP} formatter={(v:number,n:string)=>[fmt(v),n]}/>
        <ReferenceLine x={mois} stroke="var(--gold)" strokeDasharray="4 2" label={{value:"◀",position:"insideTopRight",fill:"var(--gold)",fontSize:9}}/>
        <Area type="monotone" dataKey="Livrets" stackId="g" stroke="#e6a817" strokeWidth={1.5} fill="url(#gGL4)"/>
        <Area type="monotone" dataKey="Investissements" stackId="g" stroke="#3a7bd5" strokeWidth={1.5} fill="url(#gGI4)"/>
      </AreaChart>
    </ResponsiveContainer>
  );

  return(<div>
    <div className="section-sep"><span className="section-sep-label">Récapitulatif global</span><div className="section-sep-line"/></div>
    <div className="stat-row">
      <div className="stat-card sc-gold"><div className="sc-label">Livrets · {mois}</div><div className="sc-value">{fmt(totalLivrets)}</div></div>
      <div className="stat-card sc-teal"><div className="sc-label">Investi · {mois}</div><div className="sc-value">{fmt(totalInvest)}</div></div>
      <div className="stat-card sc-lav"><div className="sc-label">Total patrimoine financier</div><div className="sc-value pos">{fmt(grandTotal)}</div></div>
    </div>
    <ChartGrid charts={[
      {key:"global_pie",   title:`Répartition globale · ${mois}`,  node:pieNode},
      {key:"global_stack", title:"Évolution mensuelle globale",     node:stackNode},
    ]}/>
  </div>);
}

// ── Main Page ──────────────────────────────────────────────────────────────────
function PatrimoineInner() {
  const [tab,setTab]=useState<"global"|"livrets"|"recap"|"investissement">("global");
  const [mois,setMois]=useState(curMonth);
  const [livrets,setLivrets]=useState<Livret[]>([]);
  const [positions,setPositions]=useState<Position[]>([]);
  const [ventes,setVentes]=useState<Vente[]>([]);
  const [dividendes,setDividendes]=useState<Dividende[]>([]);
  const [versements,setVersements]=useState<Versement[]>([]);
  const [err,setErr]=useState<string|null>(null);

  const load=useCallback(async()=>{
    try{
      const [l,p,v,d,vs]=await Promise.all([
        invoke<Livret[]>("get_livrets"),
        invoke<Position[]>("get_positions",{}),
        invoke<Vente[]>("get_ventes",{}),
        invoke<Dividende[]>("get_dividendes",{}),
        invoke<Versement[]>("get_versements",{}),
      ]);
      setLivrets(l);setPositions(p);setVentes(v);setDividendes(d);setVersements(vs);setErr(null);
    }catch(e:any){setErr(String(e));}
  },[]);
  useEffect(()=>{load();},[load]);

  const patrimoineFirstMonth=useMemo(()=>{
    const isInteret=(l:Livret)=>(l.notes??"").startsWith("[INTERET");
    const dates=[
      ...livrets.filter(l=>!isInteret(l)).map(l=>(l.date??"").slice(0,7)),
      ...positions.map(p=>(p.date_achat??"").slice(0,7)),
    ].filter(Boolean).sort();
    return dates[0];
  },[livrets,positions]);

  return(<div>
    <div className="page-header">
      <h1 className="page-title">Patrimoine</h1>
      <p className="page-sub">Livrets · Investissements · Cours en direct</p>
    </div>
    <MonthSelector value={mois} onChange={setMois} firstMonth={patrimoineFirstMonth}/>
    {err&&<div style={{padding:"12px 16px",marginBottom:16,background:"var(--rose-dim)",border:"1px solid var(--rose)",borderRadius:8,color:"var(--rose)",fontSize:12}}>⚠ {err}</div>}
    <div className="tabs">
      {[["global","Vue globale"],["livrets","Livrets"],["recap","Récap. Invest."],["investissement","Poches"]].map(([k,l])=>(
        <button key={k} className={`tab-btn ${tab===k?"active":""}`} onClick={()=>setTab(k as any)}>{l}</button>
      ))}
    </div>
    {tab==="global"&&<GlobalRecap livrets={livrets} positions={positions} ventes={ventes} mois={mois}/>}
    {tab==="livrets"&&<LivretsSection livrets={livrets} mois={mois} onRefresh={load}/>}
    {tab==="recap"&&<RecapInvestissement positions={positions} ventes={ventes} mois={mois}/>}
    {tab==="investissement"&&POCHES.map(p=>(
      <Boundary key={p.key} label={p.label}>
        <PocheSection poche={p} allPositions={positions} allVentes={ventes}
          allDividendes={dividendes} allVersements={versements} mois={mois} onRefresh={load}/>
      </Boundary>
    ))}
  </div>);
}

export default function Patrimoine(){return <Boundary label="Patrimoine"><PatrimoineInner/></Boundary>;}
