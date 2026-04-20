// ── Patrimoine page — main entry point ───────────────────────────────────────
// Split into:
//  src/pages/patrimoine/types.ts       — interfaces
//  src/pages/patrimoine/shared.tsx     — ChartGrid, NestedPie, Boundary, AccordionSection
//  src/pages/patrimoine/modals.tsx     — all modals
//  src/pages/patrimoine/LivretsSection.tsx
//  src/pages/patrimoine/PocheSection.tsx
import { useEffect, useState, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Area, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, ComposedChart, Line, Customized, Brush,
} from "recharts";
import { useDevise, curMonth } from "../context/DeviseContext";
import { usePoches, type Poche } from "../context/PochesContext";
import { useQuotes } from "../hooks/useQuotes";
import {
  LIVRETS_DEF, INVEST_SUBCATS, INVEST_SUBCAT_COLOR,
  GLOBAL_GROUP_COLORS, TOOLTIP_STYLE,
} from "../constants";
import MonthSelector from "../components/MonthSelector";
import { Boundary, ChartGrid, NestedPie, bellEffect } from "./patrimoine/shared";
import { LivretsSection } from "./patrimoine/LivretsSection";
import { PocheSection } from "./patrimoine/PocheSection";
import { exportPoche, exportScpiValuations, importPoche, importScpi, parseCsvContent,
  ImportModal, PocheFormModal, ConfirmDeleteModal, exportInvestPoches,
  type ImportPending } from "./patrimoine/InvestSettings";
import type { Livret, LivretPoche, Position, Vente, Dividende, Versement, ScpiValuation } from "./patrimoine/types";

// Index-based pixel: avoids Recharts scale domain truncation (ticks-only domain bug)
function idxPx(data: any[], x1: string, x2: string, offset: any, bStart = 0, bEnd?: number, key = "date") {
  const end = bEnd ?? data.length - 1;
  const N = end - bStart + 1;
  if (N <= 0) return null;
  const ai1 = data.findIndex((d: any) => d[key] === x1);
  let ai2 = -1; for (let i = data.length - 1; i >= 0; i--) { if ((data[i] as any)[key] === x2) { ai2 = i; break; } }
  if (ai1 < 0 || ai2 < 0) return null;
  const r1 = Math.max(0, ai1 - bStart); const r2 = Math.min(N - 1, ai2 - bStart);
  if (r2 < 0 || r1 >= N) return null;
  const denom = Math.max(1, N - 1);
  const step = N > 1 ? offset.width / (N - 1) : offset.width;
  return { rx1: offset.left + (r1 / denom) * offset.width, rx2: offset.left + (r2 / denom) * offset.width, step };
}

// Build scpiPriceMap from valuations: ticker → (month → unit price)
function buildScpiMap(vals: ScpiValuation[]): Record<string, Record<string, number>> {
  const m: Record<string, Record<string, number>> = {};
  for (const v of vals) {
    if (!m[v.ticker]) m[v.ticker] = {};
    m[v.ticker][v.mois] = v.valeur_unit;
  }
  return m;
}

// Look up SCPI unit price at or before a given month
function scpiPrice(map: Record<string, Record<string, number>>, ticker: string, month: string, fallback: number): number {
  const mm = map[ticker] ?? {};
  const keys = Object.keys(mm).filter(k => k <= month).sort();
  return keys.length ? mm[keys[keys.length - 1]] : fallback;
}

// ── Recap Investissement ───────────────────────────────────────────────────────
function RecapInvestissement({positions,ventes,dividendes,versements,mois,scpiValuations,onAddPoche,viewMode,onToggleView}:{positions:Position[];ventes:Vente[];dividendes:Dividende[];versements:Versement[];mois:string;scpiValuations:ScpiValuation[];onAddPoche?:()=>void;viewMode:"graphiques"|"poches";onToggleView:()=>void}) {
  const {fmt,fmtAxis}=useDevise();
  const {poches}=usePoches();
  const [exportAllState,setExportAllState]=useState<"idle"|"loading"|"done"|"error">("idle");
  const MN_SHORT=["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
  const [pieToggle,setPieToggle]=useState<"versements"|"investi"|"valeur">("valeur");
  const [brushIdxR,setBrushIdxR]=useState<{start:number;end:number}|null>(null);

  // SCPI price map
  const scpiPriceMap=useMemo(()=>buildScpiMap(scpiValuations),[scpiValuations]);

  // Tickers to fetch from Yahoo (exclude fond + scp — they have fixed/manual prices)
  const tickers=useMemo(()=>{
    const skip=new Set(positions.filter(p=>p.sous_categorie==="fond"||p.sous_categorie==="scp").map(p=>p.ticker));
    return [...new Set(positions.map(p=>p.ticker))].filter(t=>!skip.has(t));
  },[positions]);

  const fromMonth=useMemo(()=>{
    const d=positions.map(p=>(p.date_achat??"").slice(0,7)).filter(Boolean).sort();
    return d[0]??curMonth;
  },[positions]);
  const {quotes,getPrice:_getPrice,getPriceForDate:_getPriceForDate}=useQuotes(tickers,fromMonth);

  // Price overrides: fond=1.0, scp=manual valuation, else Yahoo
  const subcatByTicker=useMemo(()=>{
    const m:Record<string,string>={};
    positions.forEach(p=>{if(p.sous_categorie)m[p.ticker]=p.sous_categorie;});
    return m;
  },[positions]);

  const getPriceForDate=useCallback((ticker:string,dateStr:string,pru=0):number=>{
    const sc=subcatByTicker[ticker];
    if(sc==="fond")return 1.0;
    if(sc==="scp")return scpiPrice(scpiPriceMap,ticker,dateStr.slice(0,7),pru);
    return _getPriceForDate(ticker,dateStr,pru);
  },[subcatByTicker,scpiPriceMap,_getPriceForDate]);

  const getPrice=useCallback((ticker:string,month:string,pru=0):number=>{
    const sc=subcatByTicker[ticker];
    if(sc==="fond")return 1.0;
    if(sc==="scp")return scpiPrice(scpiPriceMap,ticker,month,pru);
    return _getPrice(ticker,month,pru);
  },[subcatByTicker,scpiPriceMap,_getPrice]);

  // ── Pie data — chronological aggregation, 3-state toggle ─────────────────
  const {inner,outer,grandTotal}=useMemo(()=>{
    const pocheMap:Record<string,{value:number;color:string}>={};
    const outerMap:Record<string,{value:number;color:string}>={};

    poches.forEach(p=>{
      // Chronological buy/sell replay (same as PocheSection.aggregateByTicker)
      type Ev={date:string;type:"buy"|"sell";ticker:string;subcat:string;qty:number;price:number};
      const evs:Ev[]=[
        ...positions
          .filter(pos=>pos.poche===p.key&&(pos.date_achat??"").slice(0,7)<=mois)
          .map(pos=>({date:pos.date_achat??"",type:"buy" as const,ticker:pos.ticker,subcat:pos.sous_categorie??"actions",qty:pos.quantite,price:pos.prix_achat})),
        ...ventes
          .filter(v=>v.poche===p.key&&(v.date_vente??"").slice(0,7)<=mois)
          .map(v=>({date:v.date_vente??"",type:"sell" as const,ticker:v.ticker,subcat:"",qty:v.quantite,price:0})),
      ].sort((a,b)=>a.date.localeCompare(b.date));

      const byT:Record<string,{q:number;inv:number;subcat:string}>={};
      evs.forEach(ev=>{
        if(ev.type==="buy"){
          if(!byT[ev.ticker])byT[ev.ticker]={q:0,inv:0,subcat:ev.subcat};
          byT[ev.ticker].q+=ev.qty;byT[ev.ticker].inv+=ev.qty*ev.price;
          if(ev.subcat)byT[ev.ticker].subcat=ev.subcat;
        } else if(byT[ev.ticker]){
          const pru=byT[ev.ticker].q>0?byT[ev.ticker].inv/byT[ev.ticker].q:0;
          byT[ev.ticker].q=Math.max(0,byT[ev.ticker].q-ev.qty);
          byT[ev.ticker].inv=Math.max(0,byT[ev.ticker].inv-ev.qty*pru);
          if(byT[ev.ticker].q<=1e-9)delete byT[ev.ticker];
        }
      });

      if(pieToggle==="versements"){
        // Inner = versements per poche; outer = versements distributed proportionally by subcat invested
        const versP=versements.filter(v=>v.poche===p.key&&(v.date??"").slice(0,7)<=mois).reduce((s,v)=>s+v.montant,0);
        if(versP>0){
          if(!pocheMap[p.key])pocheMap[p.key]={value:0,color:p.color};
          pocheMap[p.key].value+=versP;
          const totalInv=Object.values(byT).reduce((s,d)=>s+d.inv,0);
          if(totalInv>0){
            Object.entries(byT).forEach(([,d])=>{
              const prop=d.inv/totalInv;
              const outKey=`${p.key}||${d.subcat}`;
              const subcatColor=(INVEST_SUBCAT_COLOR[d.subcat]??p.color);
              if(!outerMap[outKey])outerMap[outKey]={value:0,color:subcatColor};
              outerMap[outKey].value+=versP*prop;
            });
          } else {
            const cashKey=`${p.key}||especes`;
            if(!outerMap[cashKey])outerMap[cashKey]={value:0,color:(INVEST_SUBCAT_COLOR["especes"]??"#78909c")};
            outerMap[cashKey].value+=versP;
          }
        }
      } else {
        // "investi" or "valeur"
        let pocheCost=0;
        Object.entries(byT).forEach(([ticker,d])=>{
          if(d.q<=1e-9)return;
          const pru=d.q>0?d.inv/d.q:0;
          const val=pieToggle==="investi"?d.inv:d.q*getPrice(ticker,mois,pru);
          if(!pocheMap[p.key])pocheMap[p.key]={value:0,color:p.color};
          pocheMap[p.key].value+=val;
          pocheCost+=d.inv;
          const outKey=`${p.key}||${d.subcat}`;
          const subcatColor=(INVEST_SUBCAT_COLOR[d.subcat]??p.color);
          if(!outerMap[outKey])outerMap[outKey]={value:0,color:subcatColor};
          outerMap[outKey].value+=val;
        });
        // Espèces (uninvested cash in the poche)
        const versTotal=versements.filter(v=>v.poche===p.key&&(v.date??"").slice(0,7)<=mois).reduce((s,v)=>s+v.montant,0);
        const pnlReal=ventes.filter(v=>v.poche===p.key&&(v.date_vente??"").slice(0,7)<=mois).reduce((s,v)=>s+v.pnl,0);
        const divTotal=dividendes.filter(d=>d.poche===p.key&&(d.date??"").slice(0,7)<=mois).reduce((s,d)=>s+d.montant,0);
        const esp=Math.max(0,versTotal+pnlReal+divTotal-pocheCost);
        if(esp>0){
          if(!pocheMap[p.key])pocheMap[p.key]={value:0,color:p.color};
          pocheMap[p.key].value+=esp;
          const cashKey=`${p.key}||especes`;
          if(!outerMap[cashKey])outerMap[cashKey]={value:0,color:(INVEST_SUBCAT_COLOR["especes"]??"#78909c")};
          outerMap[cashKey].value+=esp;
        }
      }
    });

    const inner=Object.entries(pocheMap)
      .map(([k,v])=>({name:poches.find(p=>p.key===k)?.label??k,...v}))
      .filter(e=>e.value>0);
    const outer=Object.entries(outerMap).map(([k,v])=>{
      const [pk,...rest]=k.split("||");const sk=rest.join("||");
      const pocheName=poches.find(p=>p.key===pk)?.label??pk;
      const subcatName=sk==="especes"?"Espèces":(INVEST_SUBCATS.find(s=>s.key===sk)?.label??sk);
      return{name:subcatName,group:pocheName,...v};
    }).filter(e=>e.value>0);
    const grandTotal=Object.values(pocheMap).reduce((s,v)=>s+v.value,0);
    return{inner,outer,grandTotal};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[positions,ventes,dividendes,versements,mois,pieToggle,getPrice]);

  // ── Stat cards: versements / investi / valorisation pour le mois sélectionné ──
  const statCards=useMemo(()=>{
    let vers=0,investi=0,valeur=0;
    poches.forEach(p=>{
      type Ev={date:string;type:"buy"|"sell";ticker:string;qty:number;price:number};
      const evs:Ev[]=[
        ...positions.filter(pos=>pos.poche===p.key&&(pos.date_achat??"").slice(0,7)<=mois)
          .map(pos=>({date:pos.date_achat??"",type:"buy" as const,ticker:pos.ticker,qty:pos.quantite,price:pos.prix_achat})),
        ...ventes.filter(v=>v.poche===p.key&&(v.date_vente??"").slice(0,7)<=mois)
          .map(v=>({date:v.date_vente??"",type:"sell" as const,ticker:v.ticker,qty:v.quantite,price:0})),
      ].sort((a,b)=>a.date.localeCompare(b.date));
      const byT:Record<string,{q:number;inv:number}>={};
      evs.forEach(ev=>{
        if(ev.type==="buy"){
          if(!byT[ev.ticker])byT[ev.ticker]={q:0,inv:0};
          byT[ev.ticker].q+=ev.qty;byT[ev.ticker].inv+=ev.qty*ev.price;
        } else if(byT[ev.ticker]){
          const pru=byT[ev.ticker].q>0?byT[ev.ticker].inv/byT[ev.ticker].q:0;
          byT[ev.ticker].q=Math.max(0,byT[ev.ticker].q-ev.qty);
          byT[ev.ticker].inv=Math.max(0,byT[ev.ticker].inv-ev.qty*pru);
          if(byT[ev.ticker].q<=1e-9)delete byT[ev.ticker];
        }
      });
      const cost=Object.values(byT).reduce((s,d)=>s+d.inv,0);
      const mktVal=Object.entries(byT).reduce((s,[t,d])=>s+d.q*getPrice(t,mois,d.q>0?d.inv/d.q:0),0);
      const pVers=versements.filter(v=>v.poche===p.key&&(v.date??"").slice(0,7)<=mois).reduce((s,v)=>s+v.montant,0);
      const pnlReal=ventes.filter(v=>v.poche===p.key&&(v.date_vente??"").slice(0,7)<=mois).reduce((s,v)=>s+v.pnl,0);
      const divs=dividendes.filter(d=>d.poche===p.key&&(d.date??"").slice(0,7)<=mois).reduce((s,d)=>s+d.montant,0);
      const esp=Math.max(0,pVers+pnlReal+divs-cost);
      vers+=pVers; investi+=cost; valeur+=mktVal+esp;
    });
    return{vers,investi,valeur};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[positions,ventes,dividendes,versements,mois,getPrice,poches]);

  // ── Daily stacked data (all poches — each poche area includes its own espèces) ───
  const stackedData=useMemo(()=>{
    if(!positions.length)return[];
    const firstDay=positions.map(p=>p.date_achat??"").filter(Boolean).sort()[0];
    const dayDates:string[]=[];
    const cur=new Date(firstDay.slice(0,7)+"-01");
    const now=new Date();now.setHours(23,59,59,999);
    while(cur<=now){dayDates.push(cur.toISOString().slice(0,10));cur.setDate(cur.getDate()+1);}

    type Ev={date:string;type:"buy"|"sell";poche:string;ticker:string;subcat:string;qty:number;price:number};
    const allEv:Ev[]=[
      ...positions.map(p=>({date:p.date_achat??"",type:"buy" as const,poche:p.poche,ticker:p.ticker,subcat:p.sous_categorie??"actions",qty:p.quantite,price:p.prix_achat})),
      ...ventes.map(v=>({date:v.date_vente??"",type:"sell" as const,poche:v.poche,ticker:v.ticker,subcat:"",qty:v.quantite,price:0})),
    ].sort((a,b)=>a.date.localeCompare(b.date));

    // Global cumulative (for _versTotal and _pnlTotal)
    const sortedVers=[...versements].sort((a,b)=>(a.date??"").localeCompare(b.date??""));
    const sortedVent=[...ventes].sort((a,b)=>(a.date_vente??"").localeCompare(b.date_vente??""));
    const sortedDivs=[...dividendes].sort((a,b)=>(a.date??"").localeCompare(b.date??""));

    // Per-poche cumulative (for per-poche espèces)
    const versPerP:Record<string,Versement[]>={};
    const ventPerP:Record<string,Vente[]>={};
    const divsPerP:Record<string,Dividende[]>={};
    poches.forEach(p=>{
      versPerP[p.key]=[...versements].filter(v=>v.poche===p.key).sort((a,b)=>(a.date??"").localeCompare(b.date??""));
      ventPerP[p.key]=[...ventes].filter(v=>v.poche===p.key).sort((a,b)=>(a.date_vente??"").localeCompare(b.date_vente??""));
      divsPerP[p.key]=[...dividendes].filter(d=>d.poche===p.key).sort((a,b)=>(a.date??"").localeCompare(b.date??""));
    });
    const pVC:Record<string,number>={};const pPC:Record<string,number>={};const pDC:Record<string,number>={};
    const pCumV:Record<string,number>={};const pCumP:Record<string,number>={};const pCumD:Record<string,number>={};
    poches.forEach(p=>{pVC[p.key]=0;pPC[p.key]=0;pDC[p.key]=0;pCumV[p.key]=0;pCumP[p.key]=0;pCumD[p.key]=0;});

    const byPoche:Record<string,Record<string,{q:number;inv:number;subcat:string}>>={};
    poches.forEach(p=>{byPoche[p.key]={};});
    // Track when each poche first has any activity (buy/sell or versement)
    const pocheActive:Record<string,boolean>={};
    poches.forEach(p=>{pocheActive[p.key]=false;});

    let evIdx=0,viC=0,piC=0,diC=0,cumVers=0,cumPnl=0,cumDivs=0;
    const raw=dayDates.map(dateStr=>{
      while(evIdx<allEv.length&&allEv[evIdx].date<=dateStr){
        const ev=allEv[evIdx++];
        const map=byPoche[ev.poche];if(!map)continue;
        pocheActive[ev.poche]=true;
        if(ev.type==="buy"){
          if(!map[ev.ticker])map[ev.ticker]={q:0,inv:0,subcat:ev.subcat};
          map[ev.ticker].q+=ev.qty;map[ev.ticker].inv+=ev.qty*ev.price;
          if(ev.subcat)map[ev.ticker].subcat=ev.subcat;
        }else if(map[ev.ticker]){
          const pru=map[ev.ticker].q>0?map[ev.ticker].inv/map[ev.ticker].q:0;
          map[ev.ticker].q=Math.max(0,map[ev.ticker].q-ev.qty);
          map[ev.ticker].inv=Math.max(0,map[ev.ticker].inv-ev.qty*pru);
          if(map[ev.ticker].q<=1e-9)delete map[ev.ticker];
        }
      }
      // Global cumulative
      while(viC<sortedVers.length&&(sortedVers[viC].date??"")<= dateStr)cumVers+=sortedVers[viC++].montant;
      while(piC<sortedVent.length&&(sortedVent[piC].date_vente??"")<= dateStr)cumPnl+=sortedVent[piC++].pnl;
      while(diC<sortedDivs.length&&(sortedDivs[diC].date??"")<= dateStr)cumDivs+=sortedDivs[diC++].montant;
      // Per-poche cumulative
      poches.forEach(p=>{
        const prevV=pCumV[p.key];
        while(pVC[p.key]<versPerP[p.key].length&&(versPerP[p.key][pVC[p.key]].date??"")<= dateStr)pCumV[p.key]+=versPerP[p.key][pVC[p.key]++].montant;
        if(pCumV[p.key]!==prevV)pocheActive[p.key]=true;
        while(pPC[p.key]<ventPerP[p.key].length&&(ventPerP[p.key][pPC[p.key]].date_vente??"")<= dateStr)pCumP[p.key]+=ventPerP[p.key][pPC[p.key]++].pnl;
        while(pDC[p.key]<divsPerP[p.key].length&&(divsPerP[p.key][pDC[p.key]].date??"")<= dateStr)pCumD[p.key]+=divsPerP[p.key][pDC[p.key]++].montant;
      });
      const row:any={date:dateStr,month:dateStr.slice(0,7),_versTotal:cumVers};
      let totalInvestMarket=0,totalInvested=0;
      poches.forEach(p=>{
        const pocheInvest=Object.values(byPoche[p.key]).reduce((s,d)=>s+d.inv,0);
        const investVal=Object.entries(byPoche[p.key]).reduce((s,[t,d])=>{
          const pru=d.q>0?d.inv/d.q:0;
          let unitPrice:number;
          if(d.subcat==="fond")unitPrice=1.0;
          else if(d.subcat==="scp")unitPrice=scpiPrice(scpiPriceMap,t,dateStr.slice(0,7),pru);
          else unitPrice=getPriceForDate(t,dateStr,pru);
          return s+d.q*unitPrice;
        },0);
        const esp=Math.max(0,pCumV[p.key]+pCumP[p.key]+pCumD[p.key]-pocheInvest);
        // null before first activity so chart line only starts when poche opens
        row[p.label]=pocheActive[p.key]?investVal+esp:null;
        totalInvestMarket+=investVal;
        totalInvested+=pocheInvest;
      });
      // _pnlTotal = unrealized + realized + divs (espèces not double-counted)
      row._pnlTotal=(totalInvestMarket-totalInvested)+cumPnl+cumDivs;
      row._pnlReal=cumPnl;
      // Loss zone: gap between versements line and total portfolio value
      const totalPocheVal=poches.reduce((s,p)=>s+(row[p.label]??0),0);
      row._lossArea=Math.max(0,cumVers-totalPocheVal);
      return row;
    });
    // Bell effect: add 0 on each side of null↔value transitions for smooth cloche
    return bellEffect(raw, poches.map(p=>p.label));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[positions,ventes,dividendes,versements,getPriceForDate,scpiPriceMap]);

  // Brush-limited visible slice of stacked data
  const visibleStackedData=useMemo(()=>
    brushIdxR?stackedData.slice(brushIdxR.start,brushIdxR.end+1):stackedData,
  [stackedData,brushIdxR]);

  // XAxis tick dates (first date of each month, ≤8 labels) — driven by brush
  const xTicks=useMemo(()=>{
    const seen=new Set<string>();const firsts:string[]=[];
    visibleStackedData.forEach((d:any)=>{const m=(d.date as string).slice(0,7);if(!seen.has(m)){seen.add(m);firsts.push(d.date as string);}});
    const step=Math.max(1,Math.ceil(firsts.length/8));
    return firsts.filter((_,i)=>i%step===0);
  },[visibleStackedData]);

  // Selected-month range for gold highlight — driven by brush
  const monthRange=useMemo(()=>{
    const inM=visibleStackedData.filter((d:any)=>d.month===mois);
    if(!inM.length)return null;
    return{x1:inM[0].date as string,x2:inM[inM.length-1].date as string};
  },[visibleStackedData,mois]);

  // Custom tooltip: total › versements (+ diff) › poche values
  const RECAP_SKIP=new Set(["_versTotal","_pnlTotal","_pnlReal","_lossArea"]);
  const RecapTooltip=({active,payload,label}:any)=>{
    if(!active||!payload?.length)return null;
    const row=payload[0]?.payload;
    if(!row)return null;
    const vers=row._versTotal??0;
    const items=payload.filter((p:any)=>!RECAP_SKIP.has(p.dataKey)&&p.value!==0);
    const total=items.reduce((s:number,p:any)=>s+Number(p.value),0);
    const diff=total-vers;
    return(
      <div style={{...TOOLTIP_STYLE,padding:"10px 14px",minWidth:190}}>
        <div style={{color:"var(--text-1)",fontSize:9,marginBottom:6,letterSpacing:".05em"}}>{label}</div>
        {/* Grand total */}
        <div style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:6,paddingBottom:5,borderBottom:"1px solid var(--border)"}}>
          <span style={{color:"var(--text-1)",fontSize:10}}>Total</span>
          <span style={{color:"var(--text-0)",fontSize:11,fontWeight:700}}>{fmt(total)}</span>
        </div>
        {/* Versements + différence total−versements */}
        <div style={{display:"flex",justifyContent:"space-between",gap:16,marginBottom:6,paddingBottom:5,borderBottom:"1px solid var(--border)"}}>
          <span style={{color:"#e63946",fontSize:10}}>Versements</span>
          <span style={{display:"flex",gap:6,alignItems:"baseline"}}>
            <span style={{color:"var(--text-0)",fontSize:10}}>{fmt(vers)}</span>
            <span style={{color:diff>=0?"var(--teal)":"var(--rose)",fontSize:9,fontWeight:600}}>{diff>=0?"+":" −"}{fmt(Math.abs(diff))}</span>
          </span>
        </div>
        {/* Per-poche */}
        {items.map((p:any,i:number)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:2}}>
            <span style={{color:p.stroke||p.fill||"var(--text-1)",fontSize:10}}>{p.name||p.dataKey}</span>
            <span style={{color:"var(--text-0)",fontSize:10}}>{fmt(Number(p.value))}</span>
          </div>
        ))}
      </div>
    );
  };

  const pieNode=(h:number,_isExp?:boolean)=>inner.length===0?<div className="empty">Aucune donnée</div>:(
    <NestedPie inner={inner} outer={outer} total={grandTotal} fmt={fmt} h={h}
      toggleLabel={pieToggle==="versements"?"↔ Versements":pieToggle==="investi"?"↔ Investi":"↔ Valorisation"}
      onToggle={()=>setPieToggle(v=>v==="versements"?"investi":v==="investi"?"valeur":"versements")}/>
  );
  const stackNode=(h:number,isExp?:boolean)=>stackedData.length===0?<div className="empty">Aucune donnée</div>:(()=>{
    const d=isExp?stackedData:visibleStackedData;
    return(
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={d} margin={{left:0,right:5,top:5,bottom:isExp?28:0}}>
          <defs>
            {poches.map(p=>(<linearGradient key={p.key} id={`gr_${p.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={p.color} stopOpacity={.7}/><stop offset="95%" stopColor={p.color} stopOpacity={.05}/></linearGradient>))}
            <linearGradient id="gr_loss_r" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#e63946" stopOpacity={.55}/>
              <stop offset="100%" stopColor="#e63946" stopOpacity={.15}/>
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
          <XAxis dataKey="date" ticks={xTicks} tick={{fontSize:8,fontFamily:"JetBrains Mono"}}
            tickFormatter={dd=>{const mo=parseInt(dd.slice(5,7));return MN_SHORT[mo-1]+" "+dd.slice(2,4);}}/>
          <YAxis tick={{fontSize:8,fontFamily:"JetBrains Mono"}} tickFormatter={fmtAxis} width={32} domain={[0,"auto"]}/>
          <Tooltip content={<RecapTooltip/>}/>
          {poches.map(p=><Area key={p.key} type="monotone" dataKey={p.label} stackId="r" name={p.label} stroke={p.color} strokeWidth={1.5} fill={`url(#gr_${p.key})`} dot={false}/>)}
          {/* Loss zone: stacked on top, fills gap to versements line when portfolio < versements */}
          <Area type="monotone" dataKey="_lossArea" stackId="r" name="_lossArea"
            stroke="none" strokeWidth={0} fill="url(#gr_loss_r)" legendType="none"/>
          <Line type="monotone" dataKey="_versTotal" name="Versements"
            stroke="#e63946" strokeWidth={1.5} dot={false} strokeDasharray="4 3" legendType="none"/>
          {monthRange&&(
            <Customized component={(p:any)=>{
              const bS=isExp?(brushIdxR?.start??0):0;
              const bE=isExp?(brushIdxR?.end??stackedData.length-1):visibleStackedData.length-1;
              const r=idxPx(d,monthRange.x1,monthRange.x2,p.offset,bS,bE);
              if(!r)return null;
              return<g><rect x={r.rx1} y={p.offset.top} width={Math.max(1,r.rx2-r.rx1+r.step)} height={p.offset.height}
                fill="var(--gold)" fillOpacity={0.18} stroke="var(--gold)" strokeOpacity={0.6}
                strokeDasharray="4 2" strokeWidth={1} pointerEvents="none"/></g>;
            }}/>
          )}
          {isExp&&<Brush dataKey="date" height={22} travellerWidth={6}
            stroke="var(--border)" fill="var(--bg-2)"
            startIndex={brushIdxR?.start??0}
            endIndex={brushIdxR?.end??stackedData.length-1}
            onChange={(range:any)=>{
              const{startIndex:s,endIndex:e}=range??{};
              if(s===undefined||e===undefined)return;
              const full=s===0&&e===stackedData.length-1;
              setBrushIdxR(full?null:{start:s,end:e});
            }}
            tickFormatter={()=>""}/>}
        </ComposedChart>
      </ResponsiveContainer>
    );
  })();
  return(<div>
    <div className="section-sep">
      <span className="section-sep-label">Récap. investissements</span>
      <div className="section-sep-line"/>
      <button
        className="btn btn-ghost btn-sm"
        style={{marginLeft:12,whiteSpace:"nowrap",fontSize:10,
          borderColor:exportAllState==="done"?"var(--teal)":exportAllState==="error"?"var(--rose)":undefined,
          color:exportAllState==="done"?"var(--teal)":exportAllState==="error"?"var(--rose)":undefined,
          opacity:exportAllState==="loading"?0.6:1}}
        disabled={exportAllState==="loading"}
        onClick={async()=>{
          setExportAllState("loading");
          try{
            await exportInvestPoches(poches.map(p=>p.key));
            setExportAllState("done");
            setTimeout(()=>setExportAllState("idle"),3000);
          }catch{
            setExportAllState("error");
            setTimeout(()=>setExportAllState("idle"),3000);
          }
        }}>
        {exportAllState==="loading"?"…":exportAllState==="done"?"✓ Exporté":exportAllState==="error"?"⚠ Erreur":"↓ Export"}
      </button>
      {onAddPoche&&<button className="btn btn-primary btn-sm" style={{marginLeft:6,whiteSpace:"nowrap"}} onClick={onAddPoche}>+ Poche</button>}
      <button
        className={`btn btn-sm ${viewMode==="poches"?"btn-primary":"btn-ghost"}`}
        style={{marginLeft:6,whiteSpace:"nowrap",fontSize:10}}
        title={viewMode==="graphiques"?"Afficher les poches":"Afficher les graphiques"}
        onClick={onToggleView}>
        {viewMode==="graphiques"?"Investissements":"Graphiques"}
      </button>
    </div>
    {viewMode==="graphiques"&&<>
    {/* ── Stat cards ── */}
    <div className="stat-row">
      <div className="stat-card sc-neutral">
        <div className="sc-label">Versements</div>
        <div className="sc-value">{fmt(statCards.vers)}</div>
      </div>
      <div className="stat-card sc-neutral">
        <div className="sc-label">Investi</div>
        <div className="sc-value">{fmt(statCards.investi)}</div>
      </div>
      {(()=>{
        const gain=statCards.valeur-statCards.vers;
        const gainColor=gain>=0?"var(--teal)":"var(--rose)";
        return(
          <div className="stat-card" style={{borderTop:`3px solid ${gainColor}`}}>
            <div className="sc-label">Valorisation · {mois}</div>
            <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
              <div className="sc-value">{fmt(statCards.valeur)}</div>
              {statCards.vers>0&&(
                <div style={{fontSize:13,fontWeight:700,color:gainColor}}>
                  {gain>=0?"+":"-"}{fmt(Math.abs(gain))}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
    <ChartGrid charts={[
      {key:"recap_pie",   title:`Poche / Sous-catégorie · ${mois}`, node:pieNode},
      {key:"recap_stack", title:"Valeur par poche / jour",           node:stackNode,
        onResetZoom:()=>setBrushIdxR(null), brushActive:!!brushIdxR},
    ]}/>
    </>}
  </div>);
}

// ── Global Recap ───────────────────────────────────────────────────────────────
function GlobalRecap({livrets,livretPoches,positions,ventes,dividendes,versements,mois,scpiValuations}:{livrets:Livret[];livretPoches:LivretPoche[];positions:Position[];ventes:Vente[];dividendes:Dividende[];versements:Versement[];mois:string;scpiValuations:ScpiValuation[]}) {
  const {fmt,fmtAxis}=useDevise();
  const {poches}=usePoches();
  const [pieToggle,setPieToggle]=useState<"versements"|"valeur">("valeur");
  const [brushIdxG,setBrushIdxG]=useState<{start:number;end:number}|null>(null);

  // SCPI price map
  const scpiPriceMap=useMemo(()=>buildScpiMap(scpiValuations),[scpiValuations]);

  const isInteret=(l:Livret)=>(l.notes??"").startsWith("[INTERET");
  // Legacy livrets (nom=''): use latest snapshot per type
  const latestLiv:Record<string,Livret>={};
  livrets.filter(l=>l.nom===''&&!isInteret(l)&&(l.date??"").slice(0,7)<=mois)
    .forEach(l=>{if(!latestLiv[l.poche]||l.date>latestLiv[l.poche].date)latestLiv[l.poche]=l;});
  // New livrets (nom!=''): cumulative sum per type key
  const newLivBalByType:Record<string,number>={};
  livretPoches.forEach(p=>{
    const bal=livrets.filter(l=>l.nom===p.nom&&l.poche===p.type_livret&&!isInteret(l)&&(l.date??"")<=mois.slice(0,7)+"-31")
      .reduce((s,l)=>s+l.montant,0);
    newLivBalByType[p.type_livret]=(newLivBalByType[p.type_livret]??0)+bal;
  });
  const totalLivrets=Object.values(latestLiv).reduce((s,l)=>s+l.montant,0)+Object.values(newLivBalByType).reduce((s,v)=>s+v,0);

  const allDates=[
    ...livrets.filter(l=>!isInteret(l)).map(l=>(l.date??"").slice(0,7)),
    ...positions.map(p=>(p.date_achat??"").slice(0,7)),
  ].filter(Boolean).sort();
  const firstMonth=allDates[0]??curMonth;

  // Tickers for Yahoo (exclude fond + scp)
  const allTickersGlobal=useMemo(()=>{
    const skip=new Set(positions.filter(p=>p.sous_categorie==="fond"||p.sous_categorie==="scp").map(p=>p.ticker));
    return [...new Set(positions.map(p=>p.ticker))].filter(t=>!skip.has(t));
  },[positions]);
  const fromMonthGlobal=useMemo(()=>{
    const ds=[...livrets.filter(l=>!isInteret(l)).map(l=>(l.date??"").slice(0,7)),...positions.map(p=>(p.date_achat??"").slice(0,7))].filter(Boolean).sort();
    return ds[0]??curMonth;
  },[livrets,positions]);
  const {getPrice:_getPriceGlobal,getPriceForDate:_getPriceForDateGlobal}=useQuotes(allTickersGlobal,fromMonthGlobal);

  // Price with fond/scp overrides
  const subcatByTicker=useMemo(()=>{
    const m:Record<string,string>={};
    positions.forEach(p=>{if(p.sous_categorie)m[p.ticker]=p.sous_categorie;});
    return m;
  },[positions]);
  const getPriceGlobal=useCallback((ticker:string,month:string,pru=0):number=>{
    const sc=subcatByTicker[ticker];
    if(sc==="fond")return 1.0;
    if(sc==="scp")return scpiPrice(scpiPriceMap,ticker,month,pru);
    return _getPriceGlobal(ticker,month,pru);
  },[subcatByTicker,scpiPriceMap,_getPriceGlobal]);
  const getPriceForDateGlobal=useCallback((ticker:string,dateStr:string,pru=0):number=>{
    const sc=subcatByTicker[ticker];
    if(sc==="fond")return 1.0;
    if(sc==="scp")return scpiPrice(scpiPriceMap,ticker,dateStr.slice(0,7),pru);
    return _getPriceForDateGlobal(ticker,dateStr,pru);
  },[subcatByTicker,scpiPriceMap,_getPriceForDateGlobal]);

  // Portfolio value per poche at mois — market value of positions + espèces (uninvested cash)
  const portfolioParPoche=useMemo(()=>{
    const result:Record<string,number>={};
    poches.forEach(p=>{
      type Ev={date:string;type:"buy"|"sell";ticker:string;subcat:string;qty:number;price:number};
      const evs:Ev[]=[
        ...positions.filter(pos=>pos.poche===p.key&&(pos.date_achat??"").slice(0,7)<=mois)
          .map(pos=>({date:pos.date_achat??"",type:"buy" as const,ticker:pos.ticker,subcat:pos.sous_categorie??"actions",qty:pos.quantite,price:pos.prix_achat})),
        ...ventes.filter(v=>v.poche===p.key&&(v.date_vente??"").slice(0,7)<=mois)
          .map(v=>({date:v.date_vente??"",type:"sell" as const,ticker:v.ticker,subcat:"",qty:v.quantite,price:0})),
      ].sort((a,b)=>a.date.localeCompare(b.date));
      const byT:Record<string,{q:number;inv:number;subcat:string}>={};
      evs.forEach(ev=>{
        if(ev.type==="buy"){
          if(!byT[ev.ticker])byT[ev.ticker]={q:0,inv:0,subcat:ev.subcat};
          byT[ev.ticker].q+=ev.qty;byT[ev.ticker].inv+=ev.qty*ev.price;
          if(ev.subcat)byT[ev.ticker].subcat=ev.subcat;
        } else if(byT[ev.ticker]){
          const pru=byT[ev.ticker].q>0?byT[ev.ticker].inv/byT[ev.ticker].q:0;
          byT[ev.ticker].q=Math.max(0,byT[ev.ticker].q-ev.qty);
          byT[ev.ticker].inv=Math.max(0,byT[ev.ticker].inv-ev.qty*pru);
          if(byT[ev.ticker].q<=1e-9)delete byT[ev.ticker];
        }
      });
      // Market value of held positions
      const marketVal=Object.entries(byT).reduce((s,[t,d])=>{
        if(d.q<=1e-9)return s;
        return s+d.q*getPriceGlobal(t,mois,d.q>0?d.inv/d.q:0);
      },0);
      // Espèces = versements + PnL réalisé + dividendes − montant investi dans les positions ouvertes
      const pocheCost=Object.values(byT).reduce((s,d)=>s+d.inv,0);
      const versTotal=versements.filter(v=>v.poche===p.key&&(v.date??"").slice(0,7)<=mois).reduce((s,v)=>s+v.montant,0);
      const pnlReal=ventes.filter(v=>v.poche===p.key&&(v.date_vente??"").slice(0,7)<=mois).reduce((s,v)=>s+v.pnl,0);
      const divTotal=dividendes.filter(d=>d.poche===p.key&&(d.date??"").slice(0,7)<=mois).reduce((s,d)=>s+d.montant,0);
      const esp=Math.max(0,versTotal+pnlReal+divTotal-pocheCost);
      result[p.key]=marketVal+esp;
    });
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[positions,ventes,dividendes,versements,mois,getPriceGlobal]);

  // Versements per poche up to mois
  const versParPoche=useMemo(()=>{
    const m:Record<string,number>={};
    versements.filter(v=>(v.date??"").slice(0,7)<=mois).forEach(v=>{m[v.poche]=(m[v.poche]??0)+v.montant;});
    return m;
  },[versements,mois]);

  const totalPortfolioValue=Object.values(portfolioParPoche).reduce((s,v)=>s+v,0);
  const totalVersInvest=Object.values(versParPoche).reduce((s,v)=>s+v,0);

  const investVal=pieToggle==="versements"?totalVersInvest:totalPortfolioValue;
  const inner=[
    {name:"Livrets",value:totalLivrets,color:GLOBAL_GROUP_COLORS.livrets},
    {name:"Investissements",value:investVal,color:GLOBAL_GROUP_COLORS.investissements},
  ].filter(p=>p.value>0);
  const outer=[
    // Legacy livrets (nom=''): one entry per type
    ...LIVRETS_DEF.map(l=>({name:l.label,group:"Livrets",value:latestLiv[l.key]?.montant??0,color:l.color})),
    // New livrets (nom!=''): one entry per poche nom, sorted by LIVRETS_DEF order
    ...[...livretPoches].sort((a,b)=>{
      const ia=LIVRETS_DEF.findIndex(l=>l.key===a.type_livret);
      const ib=LIVRETS_DEF.findIndex(l=>l.key===b.type_livret);
      return (ia<0?999:ia)-(ib<0?999:ib)||a.nom.localeCompare(b.nom);
    }).map(p=>{
      const typeDef=LIVRETS_DEF.find(l=>l.key===p.type_livret);
      const val=livrets.filter(lv=>lv.nom===p.nom&&lv.poche===p.type_livret&&!isInteret(lv)&&(lv.date??"").slice(0,7)<=mois).reduce((s,lv)=>s+lv.montant,0);
      return{name:p.nom,group:"Livrets",value:val,color:p.couleur||typeDef?.color||"#F0BD40"};
    }),
    ...poches.map(p=>({name:p.label,group:"Investissements",value:pieToggle==="versements"?(versParPoche[p.key]??0):(portfolioParPoche[p.key]??0),color:p.color})),
  ].filter(p=>p.value>0);
  const grandTotal=totalLivrets+investVal;

  // ── Daily evo data — one series per livret + one per poche ───────────────────
  const evoData=useMemo(()=>{
    const allRaw=[
      ...livrets.filter(l=>!isInteret(l)).map(l=>(l.date??"").slice(0,7)),
      ...positions.map(p=>(p.date_achat??"").slice(0,7)),
    ].filter(Boolean).sort();
    if(!allRaw.length)return[];
    const firstDay=allRaw[0]+"-01";
    const dayDates:string[]=[];
    const cur=new Date(firstDay);const now=new Date();now.setHours(23,59,59,999);
    while(cur<=now){dayDates.push(cur.toISOString().slice(0,10));cur.setDate(cur.getDate()+1);}

    // Pre-sort events with poche info
    type Ev2={date:string;type:"buy"|"sell";poche:string;ticker:string;subcat:string;qty:number;price:number};
    const allEvs:Ev2[]=[
      ...positions.map(p=>({date:p.date_achat??"",type:"buy" as const,poche:p.poche,ticker:p.ticker,subcat:p.sous_categorie??"actions",qty:p.quantite,price:p.prix_achat})),
      ...ventes.map(v=>({date:v.date_vente??"",type:"sell" as const,poche:v.poche,ticker:v.ticker,subcat:"",qty:v.quantite,price:0})),
    ].sort((a,b)=>a.date.localeCompare(b.date));

    // Per-poche espèces tracking
    const versPerP:Record<string,Versement[]>={};
    const ventPerP:Record<string,Vente[]>={};
    const divsPerP:Record<string,Dividende[]>={};
    const pVI:Record<string,number>={};const pPI:Record<string,number>={};const pDI:Record<string,number>={};
    const pCV:Record<string,number>={};const pCP:Record<string,number>={};const pCD:Record<string,number>={};
    poches.forEach(p=>{
      versPerP[p.key]=[...versements].filter(v=>v.poche===p.key).sort((a,b)=>(a.date??"").localeCompare(b.date??""));
      ventPerP[p.key]=[...ventes].filter(v=>v.poche===p.key).sort((a,b)=>(a.date_vente??"").localeCompare(b.date_vente??""));
      divsPerP[p.key]=[...dividendes].filter(d=>d.poche===p.key).sort((a,b)=>(a.date??"").localeCompare(b.date??""));
      pVI[p.key]=0;pPI[p.key]=0;pDI[p.key]=0;pCV[p.key]=0;pCP[p.key]=0;pCD[p.key]=0;
    });

    // Per-livret step-function tracking (legacy nom='') + cumulative for new livrets (nom!='')
    const livByKey:Record<string,{date:string;montant:number}[]>={};
    const livIdx:Record<string,number>={};
    const livVal:Record<string,number>={};
    const livActive:Record<string,boolean>={};
    LIVRETS_DEF.forEach(l=>{
      // Legacy: latest snapshot (nom='')
      livByKey[l.key]=livrets.filter(lv=>lv.nom===''&&!isInteret(lv)&&lv.poche===l.key).sort((a,b)=>(a.date??"").localeCompare(b.date??""));
      livIdx[l.key]=0;livVal[l.key]=0;livActive[l.key]=false;
    });
    // New livrets: cumulative per (type, nom) → accumulate by type key
    const newLivByType:Record<string,{date:string;montant:number}[]>={};
    const newLivIdx:Record<string,number>={};
    const newLivCum:Record<string,number>={};
    const newLivActive:Record<string,boolean>={};
    LIVRETS_DEF.forEach(l=>{newLivByType[l.key]=[];newLivIdx[l.key]=0;newLivCum[l.key]=0;newLivActive[l.key]=false;});
    livretPoches.forEach(p=>{
      const ops=livrets.filter(lv=>lv.nom===p.nom&&lv.poche===p.type_livret&&!isInteret(lv))
        .sort((a,b)=>(a.date??"").localeCompare(b.date??""));
      ops.forEach(op=>newLivByType[p.type_livret]?.push({date:op.date,montant:op.montant}));
    });
    LIVRETS_DEF.forEach(l=>{newLivByType[l.key].sort((a,b)=>a.date.localeCompare(b.date));});

    // Per-poche position tracker + activity flag
    const byPocheG:Record<string,Record<string,{q:number;inv:number;subcat:string}>>={};
    const pocheActiveG:Record<string,boolean>={};
    poches.forEach(p=>{byPocheG[p.key]={};pocheActiveG[p.key]=false;});

    let evIdx=0;
    const rawEvo=dayDates.map(dateStr=>{
      // Advance portfolio events
      while(evIdx<allEvs.length&&allEvs[evIdx].date<=dateStr){
        const ev=allEvs[evIdx++];
        const map=byPocheG[ev.poche];if(!map)continue;
        pocheActiveG[ev.poche]=true;
        if(ev.type==="buy"){
          if(!map[ev.ticker])map[ev.ticker]={q:0,inv:0,subcat:ev.subcat};
          map[ev.ticker].q+=ev.qty;map[ev.ticker].inv+=ev.qty*ev.price;
          if(ev.subcat)map[ev.ticker].subcat=ev.subcat;
        }else if(map[ev.ticker]){
          const pru=map[ev.ticker].q>0?map[ev.ticker].inv/map[ev.ticker].q:0;
          map[ev.ticker].q=Math.max(0,map[ev.ticker].q-ev.qty);
          map[ev.ticker].inv=Math.max(0,map[ev.ticker].inv-ev.qty*pru);
          if(map[ev.ticker].q<=1e-9)delete map[ev.ticker];
        }
      }
      // Advance per-poche espèces counters
      poches.forEach(p=>{
        const prevV=pCV[p.key];
        while(pVI[p.key]<versPerP[p.key].length&&(versPerP[p.key][pVI[p.key]].date??"")<= dateStr)pCV[p.key]+=versPerP[p.key][pVI[p.key]++].montant;
        if(pCV[p.key]!==prevV)pocheActiveG[p.key]=true;
        while(pPI[p.key]<ventPerP[p.key].length&&(ventPerP[p.key][pPI[p.key]].date_vente??"")<= dateStr)pCP[p.key]+=ventPerP[p.key][pPI[p.key]++].pnl;
        while(pDI[p.key]<divsPerP[p.key].length&&(divsPerP[p.key][pDI[p.key]].date??"")<= dateStr)pCD[p.key]+=divsPerP[p.key][pDI[p.key]++].montant;
      });
      // Advance livret step-function per key (legacy, nom='')
      LIVRETS_DEF.forEach(l=>{
        while(livIdx[l.key]<livByKey[l.key].length&&(livByKey[l.key][livIdx[l.key]].date??"")<= dateStr){
          livVal[l.key]=livByKey[l.key][livIdx[l.key]++].montant;
          livActive[l.key]=true;
        }
        // Advance new livret cumulative per type
        while(newLivIdx[l.key]<newLivByType[l.key].length&&newLivByType[l.key][newLivIdx[l.key]].date<=dateStr){
          newLivCum[l.key]+=newLivByType[l.key][newLivIdx[l.key]++].montant;
          newLivActive[l.key]=true;
        }
      });

      const row:any={date:dateStr,month:dateStr.slice(0,7)};
      // Livrets (bottom of stack) — combine legacy + new cumulative
      LIVRETS_DEF.forEach(l=>{
        const legVal=livActive[l.key]?livVal[l.key]:0;
        const newVal=newLivActive[l.key]?newLivCum[l.key]:0;
        const active=livActive[l.key]||newLivActive[l.key];
        row[l.label]=active?(legVal+newVal)||null:null;
      });
      // Poches (top of stack) — null before first activity
      const monthStr=dateStr.slice(0,7);
      poches.forEach(p=>{
        const map=byPocheG[p.key];
        const pocheInvest=Object.values(map).reduce((s,d)=>s+d.inv,0);
        const marketVal=Object.entries(map).reduce((s,[t,d])=>{
          if(d.q<=1e-9)return s;
          const pru=d.q>0?d.inv/d.q:0;
        return s+d.q*getPriceForDateGlobal(t,dateStr,pru);
        },0);
        const esp=Math.max(0,pCV[p.key]+pCP[p.key]+pCD[p.key]-pocheInvest);
        row[p.label]=pocheActiveG[p.key]?marketVal+esp:null;
      });
      return row;
    });
    // Bell effect: add 0 adjacent to null↔value transitions for smooth cloche
    const evoKeys=[...LIVRETS_DEF.map(l=>l.label),...poches.map(p=>p.label)];
    return bellEffect(rawEvo, evoKeys);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[livrets,livretPoches,positions,ventes,dividendes,versements,getPriceForDateGlobal]);

  const pieNode=(h:number,_isExp?:boolean)=>inner.length===0?<div className="empty">Aucune donnée</div>:(
    <NestedPie inner={inner} outer={outer} total={grandTotal} fmt={fmt} h={h}
      toggleLabel={pieToggle==="versements"?"↔ Versements":"↔ Valorisation"}
      onToggle={()=>setPieToggle(v=>v==="versements"?"valeur":"versements")}/>
  );

  // Custom tooltip for GlobalRecap — total › investissements › livrets › detail
  const _livLabels=new Set(LIVRETS_DEF.map(l=>l.label));
  const _pocheLabels=new Set(poches.map(p=>p.label));
  const GlobalTooltip=({active,payload,label}:any)=>{
    if(!active||!payload?.length)return null;
    const items=payload.filter((p:any)=>p.value!=null&&Number(p.value)>0);
    if(!items.length)return null;
    const livItems=items.filter((p:any)=>_livLabels.has(p.dataKey||p.name));
    const invItems=items.filter((p:any)=>_pocheLabels.has(p.dataKey||p.name));
    const totalLiv=livItems.reduce((s:number,p:any)=>s+Number(p.value),0);
    const totalInv=invItems.reduce((s:number,p:any)=>s+Number(p.value),0);
    const total=totalLiv+totalInv;
    return(
      <div style={{...TOOLTIP_STYLE,padding:"10px 14px",minWidth:190}}>
        {label&&<div style={{color:"var(--text-2)",fontSize:9,marginBottom:6,letterSpacing:".05em"}}>{label}</div>}
        {/* Grand total */}
        <div style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:6,paddingBottom:6,borderBottom:"1px solid var(--border)"}}>
          <span style={{color:"var(--text-1)",fontSize:10}}>Total</span>
          <span style={{color:"var(--text-0)",fontSize:11,fontWeight:700}}>{fmt(total)}</span>
        </div>
        {/* Investissements */}
        {totalInv>0&&<>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:3}}>
            <span style={{color:GLOBAL_GROUP_COLORS.investissements,fontSize:10,fontWeight:600}}>Investissements</span>
            <span style={{color:"var(--text-0)",fontSize:10,fontWeight:600}}>{fmt(totalInv)}</span>
          </div>
          {invItems.map((p:any,i:number)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:2,paddingLeft:10}}>
              <span style={{color:p.stroke||"var(--text-1)",fontSize:10}}>{p.name||p.dataKey}</span>
              <span style={{color:"var(--text-0)",fontSize:10}}>{fmt(Number(p.value))}</span>
            </div>
          ))}
        </>}
        {/* Livrets */}
        {totalLiv>0&&<>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,marginTop:4,marginBottom:3}}>
            <span style={{color:GLOBAL_GROUP_COLORS.livrets,fontSize:10,fontWeight:600}}>Livrets</span>
            <span style={{color:"var(--text-0)",fontSize:10,fontWeight:600}}>{fmt(totalLiv)}</span>
          </div>
          {livItems.map((p:any,i:number)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:2,paddingLeft:10}}>
              <span style={{color:p.stroke||"var(--text-1)",fontSize:10}}>{p.name||p.dataKey}</span>
              <span style={{color:"var(--text-0)",fontSize:10}}>{fmt(Number(p.value))}</span>
            </div>
          ))}
        </>}
      </div>
    );
  };

  const visibleEvoData=useMemo(()=>
    brushIdxG?evoData.slice(brushIdxG.start,brushIdxG.end+1):evoData,
  [evoData,brushIdxG]);

  const xTicksG=useMemo(()=>{
    const seen=new Set<string>();const firsts:string[]=[];
    visibleEvoData.forEach((d:any)=>{const m=(d.date as string).slice(0,7);if(!seen.has(m)){seen.add(m);firsts.push(d.date as string);}});
    const step=Math.max(1,Math.ceil(firsts.length/8));
    return firsts.filter((_,i)=>i%step===0);
  },[visibleEvoData]);

  const monthRangeG=useMemo(()=>{
    const inM=visibleEvoData.filter((d:any)=>d.month===mois);
    if(!inM.length)return null;
    return{x1:(inM[0] as any).date as string,x2:(inM[inM.length-1] as any).date as string};
  },[visibleEvoData,mois]);

  const MN_SHORT_G=["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

  const stackNode=(h:number,isExp?:boolean)=>evoData.length===0?<div className="empty">Aucune donnée</div>:(()=>{
    const d=isExp?evoData:visibleEvoData;
    return(
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={d} margin={{left:0,right:5,top:5,bottom:isExp?28:0}}>
          <defs>
            {LIVRETS_DEF.map(l=>(<linearGradient key={l.key} id={`gGL_${l.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={l.color} stopOpacity={.7}/><stop offset="95%" stopColor={l.color} stopOpacity={.05}/></linearGradient>))}
            {poches.map(p=>(<linearGradient key={p.key} id={`gGP_${p.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={p.color} stopOpacity={.7}/><stop offset="95%" stopColor={p.color} stopOpacity={.05}/></linearGradient>))}
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
          <XAxis dataKey="date" ticks={xTicksG} tick={{fontSize:8,fontFamily:"JetBrains Mono"}}
            tickFormatter={dd=>{const mo=parseInt(dd.slice(5,7));return MN_SHORT_G[mo-1]+" "+dd.slice(2,4);}}/>
          <YAxis tick={{fontSize:8,fontFamily:"JetBrains Mono"}} tickFormatter={fmtAxis} width={32}/>
          <Tooltip content={<GlobalTooltip/>}/>
          {/* Livrets — stacked at bottom, one area per livret */}
          {LIVRETS_DEF.map(l=><Area key={l.key} type="monotone" dataKey={l.label} stackId="g" name={l.label} stroke={l.color} strokeWidth={1.5} fill={`url(#gGL_${l.key})`} dot={false}/>)}
          {/* Investissements — stacked on top, one area per poche */}
          {poches.map(p=><Area key={p.key} type="monotone" dataKey={p.label} stackId="g" name={p.label} stroke={p.color} strokeWidth={1.5} fill={`url(#gGP_${p.key})`} dot={false}/>)}
          {monthRangeG&&(
            <Customized component={(p:any)=>{
              const bS=isExp?(brushIdxG?.start??0):0;
              const bE=isExp?(brushIdxG?.end??evoData.length-1):visibleEvoData.length-1;
              const r=idxPx(d,monthRangeG.x1,monthRangeG.x2,p.offset,bS,bE,"date");
              if(!r)return null;
              return<g><rect x={r.rx1-r.step/2} y={p.offset.top} width={Math.max(4,r.rx2-r.rx1+r.step)}
                height={p.offset.height}
                fill="var(--gold)" fillOpacity={0.18} stroke="var(--gold)" strokeOpacity={0.6}
                strokeDasharray="4 2" strokeWidth={1} pointerEvents="none"/></g>;
            }}/>
          )}
          {isExp&&<Brush dataKey="date" height={22} travellerWidth={6}
            stroke="var(--border)" fill="var(--bg-2)"
            startIndex={brushIdxG?.start??0}
            endIndex={brushIdxG?.end??evoData.length-1}
            onChange={(range:any)=>{
              const{startIndex:s,endIndex:e}=range??{};
              if(s===undefined||e===undefined)return;
              setBrushIdxG(s===0&&e===evoData.length-1?null:{start:s,end:e});
            }}
            tickFormatter={()=>""}/>}
        </ComposedChart>
      </ResponsiveContainer>
    );
  })();

  return(<div>
    <div className="section-sep"><span className="section-sep-label">Récapitulatif global</span><div className="section-sep-line"/></div>
    <div className="stat-row">
      <div className="stat-card sc-gold"><div className="sc-label">Livrets · {mois}</div><div className="sc-value">{fmt(totalLivrets)}</div></div>
      <div className="stat-card sc-teal"><div className="sc-label">Valeur invest. · {mois}</div><div className="sc-value">{fmt(totalPortfolioValue)}</div></div>
      <div className="stat-card sc-lav"><div className="sc-label">Total patrimoine financier</div><div className="sc-value pos">{fmt(totalLivrets+totalPortfolioValue)}</div></div>
    </div>
    <ChartGrid charts={[
      {key:"global_pie",   title:`Répartition globale · ${mois}`,  node:pieNode},
      {key:"global_stack", title:"Évolution globale / jour",          node:stackNode,
        onResetZoom:()=>setBrushIdxG(null), brushActive:!!brushIdxG},
    ]}/>
  </div>);
}

// ── Main Page ──────────────────────────────────────────────────────────────────
function PatrimoineInner() {
  const [tab,setTab]=useState<"global"|"livrets"|"investissements">("global");
  const [mois,setMois]=useState(curMonth);
  const { setMois: setCtxMois } = useDevise();
  const {poches,setPoches}=usePoches();
  useEffect(()=>{ setCtxMois(mois); },[mois,setCtxMois]);
  const [livrets,setLivrets]=useState<Livret[]>([]);
  const [livretPoches,setLivretPoches]=useState<LivretPoche[]>([]);
  const [positions,setPositions]=useState<Position[]>([]);
  const [ventes,setVentes]=useState<Vente[]>([]);
  const [dividendes,setDividendes]=useState<Dividende[]>([]);
  const [versements,setVersements]=useState<Versement[]>([]);
  const [scpiValuations,setScpiValuations]=useState<ScpiValuation[]>([]);
  const [err,setErr]=useState<string|null>(null);

  // ── Gestion des poches ────────────────────────────────────────────────────
  const emptyPoche: Poche = { key:"", label:"", color:"#3a7bd5" };
  const [pocheFormOpen, setPocheFormOpen] = useState(false);
  const [editingPoche, setEditingPoche]   = useState<Poche>(emptyPoche);
  const [editingKey,   setEditingKey]     = useState<string|null>(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string|null>(null);
  const [importPending, setImportPending] = useState<ImportPending|null>(null);
  const [investViewMode,setInvestViewMode]=useState<"graphiques"|"poches">("graphiques");
  const [livretViewMode,setLivretViewMode]=useState<"graphiques"|"livrets">("graphiques");

  const openAddPoche = () => { setEditingPoche(emptyPoche); setEditingKey(null); setPocheFormOpen(true); };
  const openEditPoche = (p: Poche) => { setEditingPoche({...p}); setEditingKey(p.key); setPocheFormOpen(true); };

  const handleSavePoche = async (form: Poche) => {
    const k = form.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const l = form.label.trim();
    if (!k || !l) return;
    if (editingKey === null) {
      if (poches.some(p => p.key === k)) { alert(`La clé "${k}" existe déjà.`); return; }
      await setPoches([...poches, { key:k, label:l, color:form.color }]);
    } else {
      await setPoches(poches.map(p => p.key === editingKey ? { key:editingKey, label:l, color:form.color } : p));
    }
    setPocheFormOpen(false);
  };

  const handleDeletePoche = async () => {
    if (!confirmDeleteKey) return;
    await invoke("delete_poche_data", { poche: confirmDeleteKey });
    await setPoches(poches.filter(p => p.key !== confirmDeleteKey));
    setConfirmDeleteKey(null);
  };

  function makeImportHandler(label: string, importFn: (rows: string[][], replace: boolean) => Promise<number>) {
    return (rows: string[][], rowCount: number) => {
      setImportPending({ label, rowCount, onConfirm: async (replace) => { await importFn(rows, replace); load(); } });
    };
  }

  const load=useCallback(async()=>{
    try{
      const [l,lp,p,v,d,vs,sv]=await Promise.all([
        invoke<Livret[]>("get_livrets"),
        invoke<LivretPoche[]>("get_livret_poches"),
        invoke<Position[]>("get_positions",{}),
        invoke<Vente[]>("get_ventes",{}),
        invoke<Dividende[]>("get_dividendes",{}),
        invoke<Versement[]>("get_versements",{}),
        invoke<ScpiValuation[]>("get_scpi_valuations",{}),
      ]);
      setLivrets(l);setLivretPoches(lp);setPositions(p);setVentes(v);setDividendes(d);setVersements(vs);setScpiValuations(sv);setErr(null);
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
  },[livrets,livretPoches,positions]);

  return(<div>
    {/* ── Modales de gestion des poches ── */}
    {importPending&&<ImportModal pending={importPending} onClose={()=>setImportPending(null)}/>}
    {pocheFormOpen&&<PocheFormModal editingKey={editingKey} initial={editingPoche}
      onSave={handleSavePoche} onClose={()=>setPocheFormOpen(false)}/>}
    {confirmDeleteKey&&<ConfirmDeleteModal
      label={poches.find(p=>p.key===confirmDeleteKey)?.label??confirmDeleteKey}
      onConfirm={handleDeletePoche} onClose={()=>setConfirmDeleteKey(null)}/>}

    <div className="page-header">
      <h1 className="page-title">Patrimoine</h1>
      <p className="page-sub">Livrets · Investissements · Cours en direct</p>
    </div>
    <MonthSelector value={mois} onChange={setMois} firstMonth={patrimoineFirstMonth}/>
    {err&&<div style={{padding:"12px 16px",marginBottom:16,background:"var(--rose-dim)",border:"1px solid var(--rose)",borderRadius:8,color:"var(--rose)",fontSize:12}}>⚠ {err}</div>}
    <div className="tabs">
      {[["global","Vue globale"],["livrets","Livrets"],["investissements","Investissements"]].map(([k,l])=>(
        <button key={k} className={`tab-btn ${tab===k?"active":""}`} onClick={()=>setTab(k as any)}>{l}</button>
      ))}
    </div>
    {tab==="global"&&<GlobalRecap livrets={livrets} livretPoches={livretPoches} positions={positions} ventes={ventes} dividendes={dividendes} versements={versements} mois={mois} scpiValuations={scpiValuations}/>}
    {tab==="livrets"&&<LivretsSection livrets={livrets} livretPoches={livretPoches} mois={mois} onRefresh={load} viewMode={livretViewMode} onToggleView={()=>setLivretViewMode(v=>v==="graphiques"?"livrets":"graphiques")}/>}
    {tab==="investissements"&&<RecapInvestissement positions={positions} ventes={ventes} dividendes={dividendes}
      versements={versements} mois={mois} scpiValuations={scpiValuations} onAddPoche={openAddPoche}
      viewMode={investViewMode} onToggleView={()=>setInvestViewMode(v=>v==="graphiques"?"poches":"graphiques")}/>}
    {tab==="investissements"&&investViewMode==="poches"&&poches.map((p)=>(
      <Boundary key={p.key} label={p.label}>
        <PocheSection poche={p} allPositions={positions} allVentes={ventes}
          allDividendes={dividendes} allVersements={versements} mois={mois} onRefresh={load}
          onEdit={()=>openEditPoche(p)}
          onDelete={poches.length>1?()=>setConfirmDeleteKey(p.key):undefined}
          onExport={()=>exportPoche(p.key,`${p.key}.csv`)}
          onImportParsed={makeImportHandler(p.label, importPoche(p.key))}/>
      </Boundary>
    ))}
  </div>);
}

export default function Patrimoine(){return <Boundary label="Patrimoine"><PatrimoineInner/></Boundary>;}
