import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, ComposedChart, Customized,
} from "recharts";
import { useDevise, curMonth } from "../../context/DeviseContext";
import { LIVRETS_DEF, TOOLTIP_STYLE } from "../../constants";
import { ChartGrid, NestedPie, AccordionSection } from "./shared";
import { LivretModal, InteretModal } from "./modals";
import type { Livret } from "./types";

const MN_SHORT = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

// Index-based pixel: bypasses Recharts scale domain truncation (ticks-only bug)
function idxPx(data: any[], x1: string, x2: string, offset: any) {
  const N = data.length;
  if (N === 0) return null;
  const ai1 = data.findIndex((d: any) => d.date === x1);
  let ai2 = -1; for (let i = N - 1; i >= 0; i--) { if ((data[i] as any).date === x2) { ai2 = i; break; } }
  if (ai1 < 0 || ai2 < 0) return null;
  const denom = Math.max(1, N - 1);
  const step = N > 1 ? offset.width / (N - 1) : offset.width;
  return { rx1: offset.left + (ai1 / denom) * offset.width, rx2: offset.left + (ai2 / denom) * offset.width, step };
}

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
  const interetsMap:Record<string,Livret[]>={};
  livrets.filter(l=>isInteret(l)&&parseInt((l.date??"0").slice(0,4))===annee)
    .forEach(l=>{if(!interetsMap[l.poche])interetsMap[l.poche]=[];interetsMap[l.poche].push(l);});
  const totalInterets=Object.values(interetsMap).flat().reduce((s,l)=>s+l.montant,0);

  const inner=LIVRETS_DEF.map(l=>({name:l.label,value:latest[l.key]?.montant??0,color:l.color})).filter(p=>p.value>0);
  const outer=inner.map(p=>({...p,color:p.color+"99"}));

  // ── Daily data: step-function per livret, one entry per calendar day ──────────
  const dailyData=useMemo(()=>{
    const nonInt=livrets.filter(l=>!isInteret(l));
    if(!nonInt.length)return[];

    // First and last date
    const firstDate=nonInt.map(l=>l.date??"").filter(Boolean).sort()[0];

    // Generate daily dates
    const dayDates:string[]=[];
    const cur=new Date(firstDate);
    const now=new Date();now.setHours(23,59,59,999);
    while(cur<=now){dayDates.push(cur.toISOString().slice(0,10));cur.setDate(cur.getDate()+1);}

    // Sort each poche's entries chronologically
    const byPoche:Record<string,Livret[]>={};
    nonInt.forEach(l=>{if(!byPoche[l.poche])byPoche[l.poche]=[];byPoche[l.poche].push(l);});
    Object.values(byPoche).forEach(arr=>arr.sort((a,b)=>(a.date??"").localeCompare(b.date??"")));

    // For each poche, maintain a cursor that advances with dateStr
    const cursors:Record<string,number>={};
    const curVal:Record<string,number>={};
    LIVRETS_DEF.forEach(l=>{cursors[l.key]=0;curVal[l.key]=0;});

    return dayDates.map(dateStr=>{
      LIVRETS_DEF.forEach(livDef=>{
        const arr=byPoche[livDef.key]??[];
        // Advance cursor to latest entry ≤ dateStr
        while(cursors[livDef.key]<arr.length&&(arr[cursors[livDef.key]].date??"")<= dateStr){
          curVal[livDef.key]=arr[cursors[livDef.key]].montant;
          cursors[livDef.key]++;
        }
      });
      const entry:any={date:dateStr,month:dateStr.slice(0,7)};
      LIVRETS_DEF.forEach(l=>{entry[l.label]=curVal[l.key];});
      return entry;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[livrets]);

  // XAxis ticks: first date of each month, ≤ 8 labels
  const xTicks=useMemo(()=>{
    const seen=new Set<string>();const firsts:string[]=[];
    dailyData.forEach((d:any)=>{const m=(d.date as string).slice(0,7);if(!seen.has(m)){seen.add(m);firsts.push(d.date as string);}});
    const step=Math.max(1,Math.ceil(firsts.length/8));
    return firsts.filter((_,i)=>i%step===0);
  },[dailyData]);

  // Selected-month range for gold highlight
  const monthRange=useMemo(()=>{
    const inM=dailyData.filter((d:any)=>d.month===mois);
    if(!inM.length)return null;
    return{x1:inM[0].date as string,x2:inM[inM.length-1].date as string};
  },[dailyData,mois]);

  // History entries for selected month (non-intérêts)
  const histMois=livrets.filter(l=>!isInteret(l)&&(l.date??"").slice(0,7)===mois);

  // Custom tooltip — clean style, no versements/PnL header
  const LivretTooltip=({active,payload,label}:any)=>{
    if(!active||!payload?.length)return null;
    const items=payload.filter((p:any)=>p.value>0);
    if(!items.length)return null;
    return(
      <div style={{...TOOLTIP_STYLE,padding:"10px 14px",minWidth:160}}>
        {label&&<div style={{color:"var(--text-2)",fontSize:9,marginBottom:8,letterSpacing:".05em"}}>{label}</div>}
        {items.map((p:any,i:number)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:2}}>
            <span style={{color:p.stroke??p.color??"var(--text-1)",fontSize:10}}>{p.name||p.dataKey}</span>
            <span style={{color:"var(--text-0)",fontSize:10}}>{fmt(Number(p.value))}</span>
          </div>
        ))}
      </div>
    );
  };

  const pieNode=(h:number,_isExp?:boolean)=>inner.length===0?<div className="empty">Aucune donnée</div>:(
    <NestedPie inner={inner} outer={outer} total={totalLivrets} fmt={fmt} h={h}
      toggleLabel="Capital" onToggle={()=>{}}/>
  );

  const stackNode=(h:number,_isExp?:boolean)=>dailyData.length===0?<div className="empty">Aucune donnée</div>:(
    <ResponsiveContainer width="100%" height={h}>
      <ComposedChart data={dailyData} margin={{left:0,right:5,top:5,bottom:0}}>
        <defs>{LIVRETS_DEF.map(l=>(
          <linearGradient key={l.key} id={`gl_${l.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={l.color} stopOpacity={.6}/><stop offset="95%" stopColor={l.color} stopOpacity={.05}/>
          </linearGradient>
        ))}</defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
        <XAxis dataKey="date" ticks={xTicks} tick={{fontSize:8,fontFamily:"JetBrains Mono"}}
          tickFormatter={d=>{const mo=parseInt(d.slice(5,7));return MN_SHORT[mo-1];}}/>
        <YAxis tick={{fontSize:8,fontFamily:"JetBrains Mono"}} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k€`:`${v}€`} width={45}/>
        <Tooltip content={<LivretTooltip/>}/>
        {LIVRETS_DEF.map(l=><Area key={l.key} type="stepAfter" dataKey={l.label} stackId="a"
          stroke={l.color} strokeWidth={1.5} fill={`url(#gl_${l.key})`}/>)}
        {/* Gold month highlight — rendered after series to paint on top */}
        {monthRange&&(
          <Customized component={(p:any)=>{
            const r=idxPx(dailyData,monthRange.x1,monthRange.x2,p.offset);
            if(!r)return null;
            return<g><rect x={r.rx1} y={p.offset.top} width={Math.max(1,r.rx2-r.rx1+r.step)} height={p.offset.height}
              fill="var(--gold)" fillOpacity={0.18} stroke="var(--gold)" strokeOpacity={0.6}
              strokeDasharray="4 2" strokeWidth={1} pointerEvents="none"/></g>;
          }}/>
        )}
      </ComposedChart>
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
      {key:"liv_stack", title:"Évolution par jour (empilé)",  node:stackNode},
    ]}/>

    {/* Accordion: solde history for selected month */}
    <AccordionSection label={`Soldes renseignés · ${mois}`} count={histMois.length}>
      {histMois.length===0?<div className="empty">Aucune entrée ce mois</div>:(
        <table><thead><tr><th>Poche</th><th>Montant</th><th>Date</th><th></th></tr></thead>
        <tbody>{histMois.map(l=>(
          <tr key={l.id}>
            <td><span className="badge b-gold">{LIVRETS_DEF.find(d=>d.key===l.poche)?.label??l.poche}</span></td>
            <td style={{color:"var(--gold)"}}>{fmt(l.montant)}</td>
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
