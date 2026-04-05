import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip,
} from "recharts";
import { useDevise, curMonth } from "../../context/DeviseContext";
import { LIVRETS_DEF, monthsBetween, TOOLTIP_STYLE } from "../../constants";
import { ChartGrid, NestedPie, TTP, AccordionSection } from "./shared";
import { LivretModal, InteretModal } from "./modals";
import type { Livret } from "./types";

export function LivretsSection({livrets,mois,onRefresh}:{livrets:Livret[];mois:string;onRefresh:()=>void}) {
  const {fmt}=useDevise();
  const [modal,setModal]=useState(false);
  const [interetModal,setInteretModal]=useState(false);
  const isInteret=(l:Livret)=>(l.notes??"").startsWith("[INTERET");

  const latest:Record<string,Livret>={};
  livrets.filter(l=>!isInteret(l)&&(l.date??"").slice(0,7)<=mois)
    .forEach(l=>{if(!latest[l.poche]||l.date>latest[l.poche].date)latest[l.poche]=l;});
  const totalLivrets=Object.values(latest).reduce((s,l)=>s+l.montant,0);

  const annee=parseInt(mois.slice(0,4));
  const interetsByPoche:Record<string,Livret[]>={};
  livrets.filter(l=>isInteret(l)&&parseInt((l.date??"0").slice(0,4))===annee)
    .forEach(l=>{(interetsByPoche[l.poche]??=[]).push(l);interetsByPoche[l.poche]=interetsByPoche[l.poche]||[];});
  // redo cleanly
  const interetsMap:Record<string,Livret[]>={};
  livrets.filter(l=>isInteret(l)&&parseInt((l.date??"0").slice(0,4))===annee)
    .forEach(l=>{if(!interetsMap[l.poche])interetsMap[l.poche]=[];interetsMap[l.poche].push(l);});
  const totalInterets=Object.values(interetsMap).flat().reduce((s,l)=>s+l.montant,0);

  const inner=LIVRETS_DEF.map(l=>({name:l.label,value:latest[l.key]?.montant??0,color:l.color})).filter(p=>p.value>0);
  const outer=inner.map(p=>({...p,color:p.color+"99"}));

  const allMs=livrets.filter(l=>!isInteret(l)).map(l=>(l.date??"").slice(0,7)).filter(Boolean).sort();
  const firstMonth=allMs[0]??mois;
  const evoMonths=useMemo(()=>monthsBetween(firstMonth,curMonth),[firstMonth]);
  const evoData=useMemo(()=>evoMonths.map(m=>{
    const snap:Record<string,Livret>={};
    livrets.filter(l=>!isInteret(l)&&(l.date??"").slice(0,7)<=m)
      .forEach(l=>{if(!snap[l.poche]||l.date>snap[l.poche].date)snap[l.poche]=l;});
    const entry:any={mois:m};
    LIVRETS_DEF.forEach(l=>{entry[l.label]=snap[l.key]?.montant??0;});
    return entry;
  }),[evoMonths,livrets]);

  // History entries for selected month (non-intérêts)
  const histMois=livrets.filter(l=>!isInteret(l)&&(l.date??"").slice(0,7)===mois);

  const pieNode=(h:number,_isExp?:boolean)=>inner.length===0?<div className="empty">Aucune donnée</div>:(
    <NestedPie inner={inner} outer={outer} total={totalLivrets} fmt={fmt} h={h}
      toggleLabel="Capital" onToggle={()=>{}}/>
  );

  const stackNode=(h:number,_isExp?:boolean)=>evoData.length===0?<div className="empty">Aucune donnée</div>:(
    <ResponsiveContainer width="100%" height={h}>
      <AreaChart data={evoData}>
        <defs>{LIVRETS_DEF.map(l=>(
          <linearGradient key={l.key} id={`gl_${l.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={l.color} stopOpacity={.6}/><stop offset="95%" stopColor={l.color} stopOpacity={.05}/>
          </linearGradient>
        ))}</defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
        <XAxis dataKey="mois" tick={{fontSize:8,fontFamily:"JetBrains Mono"}} interval={Math.max(0,Math.floor(evoData.length/7)-1)}/>
        <YAxis tick={{fontSize:8,fontFamily:"JetBrains Mono"}} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k€`:`${v}€`} width={45}/>
        <Tooltip {...TTP} formatter={(v:number,n:string)=>[fmt(v),n]}/>
        <ReferenceLine x={mois} stroke="var(--gold)" strokeDasharray="4 2"/>
        {LIVRETS_DEF.map(l=><Area key={l.key} type="monotone" dataKey={l.label} stackId="a"
          stroke={l.color} strokeWidth={1.5} fill={`url(#gl_${l.key})`}/>)}
      </AreaChart>
    </ResponsiveContainer>
  );

  return(<div>
    <div className="section-sep">
      <span className="section-sep-label">Livrets réglementés</span>
      <div className="section-sep-line"/>
      <button className="btn btn-ghost btn-sm" onClick={()=>setInteretModal(true)}>+ Intérêts</button>
      <button className="btn btn-primary btn-sm" onClick={()=>setModal(true)}>+ Mise à jour</button>
    </div>

    {/* Global summary */}
    <div style={{display:"flex",gap:16,marginBottom:16,flexWrap:"wrap"}}>
      <div className="stat-card sc-gold" style={{minWidth:160}}>
        <div className="sc-label">Total · {mois}</div>
        <div className="sc-value">{fmt(totalLivrets)}</div>
      </div>
      <div className="stat-card sc-neutral" style={{minWidth:160}}>
        <div className="sc-label">Intérêts {annee}</div>
        <div className="sc-value" style={{color:"var(--gold)"}}>{totalInterets>0?fmt(totalInterets):"—"}</div>
      </div>
    </div>

    {/* Per-livret cards */}
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
      {LIVRETS_DEF.map(l=>(
        <div key={l.key} style={{background:"var(--bg-1)",border:"1px solid var(--border)",borderRadius:"var(--r)",
          padding:"14px 18px",minWidth:140,flex:"1",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:l.color}}/>
          <div style={{fontSize:10,color:l.color,marginBottom:6}}>{l.label}</div>
          <div style={{fontFamily:"var(--serif)",fontSize:18,color:"var(--text-0)"}}>{latest[l.key]?fmt(latest[l.key].montant):"—"}</div>
          {interetsMap[l.key]&&(
            <div style={{fontSize:11,color:"var(--gold)",marginTop:4}}>
              +{fmt(interetsMap[l.key].reduce((s,i)=>s+i.montant,0))} intérêts {annee}
            </div>
          )}
          <div style={{fontSize:10,color:"var(--text-2)",marginTop:3}}>Taux {latest[l.key]?.taux??l.taux} %</div>
        </div>
      ))}
    </div>

    <ChartGrid charts={[
      {key:"liv_pie",   title:`Répartition · ${mois}`,       node:pieNode},
      {key:"liv_stack", title:"Évolution mensuelle (empilé)", node:stackNode},
    ]}/>

    {/* Accordion: solde history for selected month */}
    <AccordionSection label={`Soldes renseignés · ${mois}`} count={histMois.length}>
      {histMois.length===0?<div className="empty">Aucune entrée ce mois</div>:(
        <table><thead><tr><th>Poche</th><th>Montant</th><th>Taux</th><th>Date</th><th></th></tr></thead>
        <tbody>{histMois.map(l=>(
          <tr key={l.id}>
            <td><span className="badge b-gold">{LIVRETS_DEF.find(d=>d.key===l.poche)?.label??l.poche}</span></td>
            <td style={{color:"var(--gold)"}}>{fmt(l.montant)}</td>
            <td style={{color:"var(--text-1)"}}>{(l.taux??0).toFixed(2)} %</td>
            <td style={{color:"var(--text-1)"}}>{l.date}</td>
            <td><button className="btn btn-danger btn-sm" onClick={async()=>{await invoke("delete_livret",{id:l.id});onRefresh();}}>✕</button></td>
          </tr>
        ))}</tbody></table>
      )}
    </AccordionSection>

    {/* Accordion: intérêts for selected year */}
    <AccordionSection label={`Intérêts renseignés · ${annee}`} count={Object.values(interetsMap).flat().length} color="var(--gold)">
      {Object.values(interetsMap).flat().length===0?<div className="empty">Aucun intérêt {annee}</div>:(
        <table><thead><tr><th>Poche</th><th>Montant</th><th>Notes</th><th></th></tr></thead>
        <tbody>{Object.values(interetsMap).flat().map(l=>(
          <tr key={l.id}>
            <td><span className="badge b-gold">{LIVRETS_DEF.find(d=>d.key===l.poche)?.label??l.poche}</span></td>
            <td style={{color:"var(--gold)"}}>{fmt(l.montant)}</td>
            <td style={{color:"var(--text-2)"}}>{(l.notes??"").replace(/\[INTERET \d+\]\s*/,"")}</td>
            <td><button className="btn btn-danger btn-sm" onClick={async()=>{await invoke("delete_livret",{id:l.id});onRefresh();}}>✕</button></td>
          </tr>
        ))}</tbody></table>
      )}
    </AccordionSection>

    {modal&&<LivretModal mois={mois} onClose={()=>setModal(false)} onSave={()=>{setModal(false);onRefresh();}}/>}
    {interetModal&&<InteretModal mois={mois} onClose={()=>setInteretModal(false)} onSave={()=>{setInteretModal(false);onRefresh();}}/>}
  </div>);
}
