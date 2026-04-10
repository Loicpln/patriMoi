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
import { useQuotes } from "../hooks/useQuotes";
import {
  LIVRETS_DEF, POCHES, INVEST_SUBCATS, INVEST_SUBCAT_COLOR,
  TOOLTIP_STYLE, monthsBetween,
} from "../constants";
import MonthSelector from "../components/MonthSelector";
import { Boundary, ChartGrid, NestedPie } from "./patrimoine/shared";
import { LivretsSection } from "./patrimoine/LivretsSection";
import { PocheSection } from "./patrimoine/PocheSection";
import type { Livret, Position, Vente, Dividende, Versement, ScpiValuation } from "./patrimoine/types";

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
function RecapInvestissement({positions,ventes,dividendes,versements,mois,scpiValuations}:{positions:Position[];ventes:Vente[];dividendes:Dividende[];versements:Versement[];mois:string;scpiValuations:ScpiValuation[]}) {
  const {fmt}=useDevise();
  const MN_SHORT=["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
  const [pieToggle,setPieToggle]=useState<"investi"|"valeur">("valeur");
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

  // ── Pie data ──────────────────────────────────────────────────────────────
  // outer ring: grouped by poche+subcat so CTO Actions ≠ PEA Actions, and subcat color used
  const pocheMap:Record<string,{value:number;color:string}>={};
  const outerMap:Record<string,{value:number;color:string}>={};
  POCHES.forEach(p=>{
    const byT:Record<string,{q:number;inv:number;subcat:string}>={};
    positions.filter(pos=>pos.poche===p.key&&(pos.date_achat??"").slice(0,7)<=mois).forEach(pos=>{
      if(!byT[pos.ticker])byT[pos.ticker]={q:0,inv:0,subcat:pos.sous_categorie??"actions"};
      byT[pos.ticker].q+=pos.quantite;byT[pos.ticker].inv+=pos.quantite*pos.prix_achat;
    });
    ventes.filter(v=>v.poche===p.key&&(v.date_vente??"").slice(0,7)<=mois).forEach(v=>{
      if(byT[v.ticker]){const pru2=byT[v.ticker].q>0?byT[v.ticker].inv/byT[v.ticker].q:0;byT[v.ticker].q=Math.max(0,byT[v.ticker].q-v.quantite);byT[v.ticker].inv=Math.max(0,byT[v.ticker].inv-v.quantite*pru2);}
    });
    let pocheCost=0;
    Object.entries(byT).forEach(([ticker,d])=>{
      if(d.q<=1e-9)return;
      const pru=d.q>0?d.inv/d.q:0;
      const val=pieToggle==="investi"?d.inv:(d.q*(getPrice(ticker,mois,pru)));
      if(!pocheMap[p.key])pocheMap[p.key]={value:0,color:p.color};
      pocheMap[p.key].value+=val;
      pocheCost+=d.inv;
      const outKey=`${p.key}||${d.subcat}`;
      // Use INVEST_SUBCAT_COLOR for the subcat segment color (same as PocheSection pies)
      const subcatColor=(INVEST_SUBCAT_COLOR[d.subcat]??p.color)+"cc";
      if(!outerMap[outKey])outerMap[outKey]={value:0,color:subcatColor};
      outerMap[outKey].value+=val;
    });
    // Espèces per poche
    const versTotal=versements.filter(v=>v.poche===p.key&&(v.date??"").slice(0,7)<=mois).reduce((s,v)=>s+v.montant,0);
    const pnlReal=ventes.filter(v=>v.poche===p.key&&(v.date_vente??"").slice(0,7)<=mois).reduce((s,v)=>s+v.pnl,0);
    const divTotal=dividendes.filter(d=>d.poche===p.key&&(d.date??"").slice(0,7)<=mois).reduce((s,d)=>s+d.montant,0);
    const esp=Math.max(0,versTotal+pnlReal+divTotal-pocheCost);
    if(esp>0){
      if(!pocheMap[p.key])pocheMap[p.key]={value:0,color:p.color};
      pocheMap[p.key].value+=esp;
      const cashKey=`${p.key}||especes`;
      if(!outerMap[cashKey])outerMap[cashKey]={value:0,color:(INVEST_SUBCAT_COLOR["especes"]??"#78909c")+"cc"};
      outerMap[cashKey].value+=esp;
    }
  });
  const inner=Object.entries(pocheMap).map(([k,v])=>({name:POCHES.find(p=>p.key===k)?.label??k,...v})).filter(e=>e.value>0);
  const outer=Object.entries(outerMap).map(([k,v])=>{
    const [pk,...rest]=k.split("||");const sk=rest.join("||");
    const pocheName=POCHES.find(p=>p.key===pk)?.label??pk;
    const subcatName=sk==="especes"?"Espèces":(INVEST_SUBCATS.find(s=>s.key===sk)?.label??sk);
    return{name:subcatName,group:pocheName,...v};
  }).filter(e=>e.value>0);
  const grandTotal=Object.values(pocheMap).reduce((s,v)=>s+v.value,0);

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
    POCHES.forEach(p=>{
      versPerP[p.key]=[...versements].filter(v=>v.poche===p.key).sort((a,b)=>(a.date??"").localeCompare(b.date??""));
      ventPerP[p.key]=[...ventes].filter(v=>v.poche===p.key).sort((a,b)=>(a.date_vente??"").localeCompare(b.date_vente??""));
      divsPerP[p.key]=[...dividendes].filter(d=>d.poche===p.key).sort((a,b)=>(a.date??"").localeCompare(b.date??""));
    });
    const pVC:Record<string,number>={};const pPC:Record<string,number>={};const pDC:Record<string,number>={};
    const pCumV:Record<string,number>={};const pCumP:Record<string,number>={};const pCumD:Record<string,number>={};
    POCHES.forEach(p=>{pVC[p.key]=0;pPC[p.key]=0;pDC[p.key]=0;pCumV[p.key]=0;pCumP[p.key]=0;pCumD[p.key]=0;});

    const byPoche:Record<string,Record<string,{q:number;inv:number;subcat:string}>>={};
    POCHES.forEach(p=>{byPoche[p.key]={};});

    let evIdx=0,viC=0,piC=0,diC=0,cumVers=0,cumPnl=0,cumDivs=0;
    return dayDates.map(dateStr=>{
      while(evIdx<allEv.length&&allEv[evIdx].date<=dateStr){
        const ev=allEv[evIdx++];
        const map=byPoche[ev.poche];if(!map)continue;
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
      POCHES.forEach(p=>{
        while(pVC[p.key]<versPerP[p.key].length&&(versPerP[p.key][pVC[p.key]].date??"")<= dateStr)pCumV[p.key]+=versPerP[p.key][pVC[p.key]++].montant;
        while(pPC[p.key]<ventPerP[p.key].length&&(ventPerP[p.key][pPC[p.key]].date_vente??"")<= dateStr)pCumP[p.key]+=ventPerP[p.key][pPC[p.key]++].pnl;
        while(pDC[p.key]<divsPerP[p.key].length&&(divsPerP[p.key][pDC[p.key]].date??"")<= dateStr)pCumD[p.key]+=divsPerP[p.key][pDC[p.key]++].montant;
      });
      const row:any={date:dateStr,month:dateStr.slice(0,7),_versTotal:cumVers};
      let totalInvestMarket=0,totalInvested=0;
      POCHES.forEach(p=>{
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
        row[p.label]=investVal+esp;
        totalInvestMarket+=investVal;
        totalInvested+=pocheInvest;
      });
      // _pnlTotal = unrealized + realized + divs (espèces not double-counted)
      row._pnlTotal=(totalInvestMarket-totalInvested)+cumPnl+cumDivs;
      return row;
    });
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

  // Custom tooltip: versements first + PnL beside it, then poche values
  const RecapTooltip=({active,payload,label}:any)=>{
    if(!active||!payload?.length)return null;
    const row=payload[0]?.payload;
    if(!row)return null;
    const vers=row._versTotal??0;
    const pnl=row._pnlTotal??0;
    const items=payload.filter((p:any)=>p.dataKey!=="_versTotal"&&p.dataKey!=="_pnlTotal");
    return(
      <div style={{...TOOLTIP_STYLE,padding:"10px 14px",minWidth:180}}>
        <div style={{color:"var(--text-1)",fontSize:9,marginBottom:8,letterSpacing:".05em"}}>{label}</div>
        {/* Versements first with PnL on same row */}
        <div style={{display:"flex",justifyContent:"space-between",gap:16,marginBottom:6,borderBottom:"1px solid var(--border)",paddingBottom:5}}>
          <span style={{color:"#e63946",fontSize:10}}>Versements&nbsp;{fmt(vers)}</span>
          <span style={{color:pnl>=0?"var(--teal)":"var(--rose)",fontSize:11,fontWeight:700}}>{pnl>=0?"+":" −"}{fmt(Math.abs(pnl))}</span>
        </div>
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
      toggleLabel={pieToggle==="investi"?"↔ Investi":"↔ Valeur"}
      onToggle={()=>setPieToggle(v=>v==="investi"?"valeur":"investi")}/>
  );
  const stackNode=(h:number,isExp?:boolean)=>stackedData.length===0?<div className="empty">Aucune donnée</div>:(()=>{
    const d=isExp?stackedData:visibleStackedData;
    return(
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={d} margin={{left:0,right:5,top:5,bottom:isExp?28:0}}>
          <defs>
            {POCHES.map(p=>(<linearGradient key={p.key} id={`gr_${p.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={p.color} stopOpacity={.7}/><stop offset="95%" stopColor={p.color} stopOpacity={.05}/></linearGradient>))}
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
          <XAxis dataKey="date" ticks={xTicks} tick={{fontSize:8,fontFamily:"JetBrains Mono"}}
            tickFormatter={dd=>{const mo=parseInt(dd.slice(5,7));return MN_SHORT[mo-1];}}/>
          <YAxis tick={{fontSize:8,fontFamily:"JetBrains Mono"}} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k€`:`${v}€`} width={45} domain={[0,"auto"]}/>
          <Tooltip content={<RecapTooltip/>}/>
          {POCHES.map(p=><Area key={p.key} type="monotone" dataKey={p.label} stackId="r" name={p.label} stroke={p.color} strokeWidth={1.5} fill={`url(#gr_${p.key})`}/>)}
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
    <div className="section-sep"><span className="section-sep-label">Récap. investissements</span><div className="section-sep-line"/></div>
    <ChartGrid charts={[
      {key:"recap_pie",   title:`Poche / Sous-catégorie · ${mois}`, node:pieNode},
      {key:"recap_stack", title:"Valeur par poche / jour",           node:stackNode,
        onResetZoom:()=>setBrushIdxR(null), brushActive:!!brushIdxR},
    ]}/>
  </div>);
}

// ── Global Recap ───────────────────────────────────────────────────────────────
function GlobalRecap({livrets,positions,ventes,versements,mois,scpiValuations}:{livrets:Livret[];positions:Position[];ventes:Vente[];versements:Versement[];mois:string;scpiValuations:ScpiValuation[]}) {
  const {fmt}=useDevise();
  const [pieToggle,setPieToggle]=useState<"versements"|"valeur">("valeur");
  const [brushIdxG,setBrushIdxG]=useState<{start:number;end:number}|null>(null);

  // SCPI price map
  const scpiPriceMap=useMemo(()=>buildScpiMap(scpiValuations),[scpiValuations]);

  const isInteret=(l:Livret)=>(l.notes??"").startsWith("[INTERET");
  const latestLiv:Record<string,Livret>={};
  livrets.filter(l=>!isInteret(l)&&(l.date??"").slice(0,7)<=mois)
    .forEach(l=>{if(!latestLiv[l.poche]||l.date>latestLiv[l.poche].date)latestLiv[l.poche]=l;});
  const totalLivrets=Object.values(latestLiv).reduce((s,l)=>s+l.montant,0);

  const allDates=[
    ...livrets.filter(l=>!isInteret(l)).map(l=>(l.date??"").slice(0,7)),
    ...positions.map(p=>(p.date_achat??"").slice(0,7)),
  ].filter(Boolean).sort();
  const firstMonth=allDates[0]??curMonth;
  const evoMonths=useMemo(()=>monthsBetween(firstMonth,curMonth),[firstMonth]);

  // Tickers for Yahoo (exclude fond + scp)
  const allTickersGlobal=useMemo(()=>{
    const skip=new Set(positions.filter(p=>p.sous_categorie==="fond"||p.sous_categorie==="scp").map(p=>p.ticker));
    return [...new Set(positions.map(p=>p.ticker))].filter(t=>!skip.has(t));
  },[positions]);
  const fromMonthGlobal=useMemo(()=>{
    const ds=[...livrets.filter(l=>!isInteret(l)).map(l=>(l.date??"").slice(0,7)),...positions.map(p=>(p.date_achat??"").slice(0,7))].filter(Boolean).sort();
    return ds[0]??curMonth;
  },[livrets,positions]);
  const {getPrice:_getPriceGlobal}=useQuotes(allTickersGlobal,fromMonthGlobal);

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

  // Helper: chronological portfolio value per poche at a given month
  const portfolioParPoche=useMemo(()=>{
    const result:Record<string,number>={};
    POCHES.forEach(p=>{
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
      result[p.key]=Object.entries(byT).reduce((s,[t,d])=>s+d.q*getPriceGlobal(t,mois,d.q>0?d.inv/d.q:0),0);
    });
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[positions,ventes,mois,getPriceGlobal]);

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
    {name:"Livrets",value:totalLivrets,color:"#e6a817"},
    {name:"Investissements",value:investVal,color:"#3a7bd5"},
  ].filter(p=>p.value>0);
  const outer=[
    ...LIVRETS_DEF.map(l=>({name:l.label,group:"Livrets",value:latestLiv[l.key]?.montant??0,color:l.color+"cc"})),
    ...POCHES.map(p=>({name:p.label,group:"Investissements",value:pieToggle==="versements"?(versParPoche[p.key]??0):(portfolioParPoche[p.key]??0),color:p.color+"cc"})),
  ].filter(p=>p.value>0);
  const grandTotal=totalLivrets+investVal;

  const evoData=useMemo(()=>evoMonths.map(m=>{
    const snap:Record<string,Livret>={};
    livrets.filter(l=>!isInteret(l)&&(l.date??"").slice(0,7)<=m).forEach(l=>{if(!snap[l.poche]||l.date>snap[l.poche].date)snap[l.poche]=l;});
    const livTotal=Object.values(snap).reduce((s,l)=>s+l.montant,0);
    type Ev2={date:string;type:"buy"|"sell";ticker:string;subcat:string;qty:number;price:number};
    const evs2:Ev2[]=[
      ...positions.map(p=>({date:p.date_achat??"",type:"buy" as const,ticker:p.ticker,subcat:p.sous_categorie??"actions",qty:p.quantite,price:p.prix_achat})),
      ...ventes.map(v=>({date:v.date_vente??"",type:"sell" as const,ticker:v.ticker,subcat:"",qty:v.quantite,price:0})),
    ].sort((a,b)=>a.date.localeCompare(b.date));
    const byT:Record<string,{q:number;inv:number;subcat:string}>={};
    evs2.filter(ev=>ev.date.slice(0,7)<=m).forEach(ev=>{
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
    const invTotal=Object.entries(byT).reduce((s,[t,d])=>s+d.q*getPriceGlobal(t,m,d.q>0?d.inv/d.q:0),0);
    return{mois:m,Livrets:livTotal,Investissements:invTotal};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }),[evoMonths,livrets,positions,ventes,getPriceGlobal]);

  const pieNode=(h:number,_isExp?:boolean)=>inner.length===0?<div className="empty">Aucune donnée</div>:(
    <NestedPie inner={inner} outer={outer} total={grandTotal} fmt={fmt} h={h}
      toggleLabel={pieToggle==="versements"?"↔ Versements":"↔ Valeur"}
      onToggle={()=>setPieToggle(v=>v==="versements"?"valeur":"versements")}/>
  );

  // Custom tooltip for GlobalRecap — versements first line
  const GlobalTooltip=({active,payload,label}:any)=>{
    if(!active||!payload?.length)return null;
    return(
      <div style={{...TOOLTIP_STYLE,padding:"10px 14px",minWidth:160}}>
        <div style={{color:"var(--text-1)",fontSize:9,marginBottom:6,letterSpacing:".05em"}}>{label}</div>
        {payload.map((p:any,i:number)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:2}}>
            <span style={{color:p.stroke||p.fill||"var(--text-1)",fontSize:10}}>{p.name||p.dataKey}</span>
            <span style={{color:"var(--text-0)",fontSize:10}}>{fmt(Number(p.value))}</span>
          </div>
        ))}
      </div>
    );
  };

  const visibleEvoData=useMemo(()=>
    brushIdxG?evoData.slice(brushIdxG.start,brushIdxG.end+1):evoData,
  [evoData,brushIdxG]);

  const stackNode=(h:number,isExp?:boolean)=>evoData.length===0?<div className="empty">Aucune donnée</div>:(()=>{
    const d=isExp?evoData:visibleEvoData;
    return(
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={d} margin={{left:0,right:5,top:5,bottom:isExp?28:0}}>
          <defs>
            <linearGradient id="gGL4" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#e6a817" stopOpacity={.7}/><stop offset="95%" stopColor="#e6a817" stopOpacity={.05}/></linearGradient>
            <linearGradient id="gGI4" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3a7bd5" stopOpacity={.7}/><stop offset="95%" stopColor="#3a7bd5" stopOpacity={.05}/></linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
          <XAxis dataKey="mois" tick={{fontSize:8,fontFamily:"JetBrains Mono"}}
            interval={Math.max(0,Math.floor(d.length/7)-1)}/>
          <YAxis tick={{fontSize:8,fontFamily:"JetBrains Mono"}} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k€`:`${v}€`} width={45}/>
          <Tooltip content={<GlobalTooltip/>}/>
          <Area type="monotone" dataKey="Livrets" stackId="g" stroke="#e6a817" strokeWidth={1.5} fill="url(#gGL4)"/>
          <Area type="monotone" dataKey="Investissements" stackId="g" stroke="#3a7bd5" strokeWidth={1.5} fill="url(#gGI4)"/>
          <Customized component={(p:any)=>{
            const bS=isExp?(brushIdxG?.start??0):0;
            const bE=isExp?(brushIdxG?.end??evoData.length-1):visibleEvoData.length-1;
            const r=idxPx(d,mois,mois,p.offset,bS,bE,"mois");
            if(!r)return null;
            return<g><rect x={r.rx1-r.step/2} y={p.offset.top} width={Math.max(4,r.step)}
              height={p.offset.height}
              fill="var(--gold)" fillOpacity={0.18} stroke="var(--gold)" strokeOpacity={0.6}
              strokeDasharray="4 2" strokeWidth={1} pointerEvents="none"/></g>;
          }}/>
          {isExp&&<Brush dataKey="mois" height={22} travellerWidth={6}
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
      {key:"global_stack", title:"Évolution mensuelle globale",     node:stackNode,
        onResetZoom:()=>setBrushIdxG(null), brushActive:!!brushIdxG},
    ]}/>
  </div>);
}

// ── Main Page ──────────────────────────────────────────────────────────────────
function PatrimoineInner() {
  const [tab,setTab]=useState<"global"|"livrets"|"investissements">("global");
  const [mois,setMois]=useState(curMonth);
  const [livrets,setLivrets]=useState<Livret[]>([]);
  const [positions,setPositions]=useState<Position[]>([]);
  const [ventes,setVentes]=useState<Vente[]>([]);
  const [dividendes,setDividendes]=useState<Dividende[]>([]);
  const [versements,setVersements]=useState<Versement[]>([]);
  const [scpiValuations,setScpiValuations]=useState<ScpiValuation[]>([]);
  const [err,setErr]=useState<string|null>(null);

  const load=useCallback(async()=>{
    try{
      const [l,p,v,d,vs,sv]=await Promise.all([
        invoke<Livret[]>("get_livrets"),
        invoke<Position[]>("get_positions",{}),
        invoke<Vente[]>("get_ventes",{}),
        invoke<Dividende[]>("get_dividendes",{}),
        invoke<Versement[]>("get_versements",{}),
        invoke<ScpiValuation[]>("get_scpi_valuations",{}),
      ]);
      setLivrets(l);setPositions(p);setVentes(v);setDividendes(d);setVersements(vs);setScpiValuations(sv);setErr(null);
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
      {[["global","Vue globale"],["livrets","Livrets"],["investissements","Investissements"]].map(([k,l])=>(
        <button key={k} className={`tab-btn ${tab===k?"active":""}`} onClick={()=>setTab(k as any)}>{l}</button>
      ))}
    </div>
    {tab==="global"&&<GlobalRecap livrets={livrets} positions={positions} ventes={ventes} versements={versements} mois={mois} scpiValuations={scpiValuations}/>}
    {tab==="livrets"&&<LivretsSection livrets={livrets} mois={mois} onRefresh={load}/>}
    {tab==="investissements"&&<RecapInvestissement positions={positions} ventes={ventes} dividendes={dividendes} versements={versements} mois={mois} scpiValuations={scpiValuations}/>}
    {tab==="investissements"&&POCHES.map((p: typeof POCHES[number])=>(
      <Boundary key={p.key} label={p.label}>
        <PocheSection poche={p} allPositions={positions} allVentes={ventes}
          allDividendes={dividendes} allVersements={versements} mois={mois} onRefresh={load}/>
      </Boundary>
    ))}
  </div>);
}

export default function Patrimoine(){return <Boundary label="Patrimoine"><PatrimoineInner/></Boundary>;}
