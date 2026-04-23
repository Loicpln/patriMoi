// ── Shared UI components for Patrimoine ───────────────────────────────────────
import { useState, Component, ReactNode } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from "recharts";
import { TOOLTIP_STYLE } from "../../constants";

// ── Error Boundary ─────────────────────────────────────────────────────────────
export class Boundary extends Component<{label:string;children:ReactNode},{err:string|null}> {
  constructor(p:any){super(p);this.state={err:null};}
  static getDerivedStateFromError(e:Error){return{err:e.message};}
  componentDidCatch(e:Error){console.error("[Boundary]",e);}
  render(){
    if(this.state.err)return(
      <div style={{padding:"12px 16px",margin:"8px 0",background:"var(--rose-dim)",border:"1px solid var(--rose)",borderRadius:10,color:"var(--rose)",fontSize:12}}>
        ⚠ {this.props.label}: {this.state.err}
        <button className="btn btn-ghost btn-sm" style={{marginLeft:12}} onClick={()=>this.setState({err:null})}>Réessayer</button>
      </div>
    );
    return this.props.children;
  }
}

// ── Shared tooltip props ───────────────────────────────────────────────────────
export const TTP = {
  contentStyle: TOOLTIP_STYLE,
  itemStyle:    { color: "var(--text-0)" },
  labelStyle:   { color: "var(--text-1)" },
};

/**
 * Lisse les transitions null↔valeur dans les données de graphique :
 * - Point isolé : null, VAL, null  →  0, VAL, 0  (cloche)
 * - Début de série : null, null, VAL  →  null, 0, VAL  (montée douce)
 * - Fin de série : VAL, null, null  →  VAL, 0, null  (descente douce)
 *
 * Utilise les données originales pour les vérifications afin d'éviter
 * tout effet cascade lors du parcours séquentiel.
 */
export function bellEffect(data: any[], keys: string[]): any[] {
  const result = data.map(r => ({ ...r }));
  for (const key of keys) {
    for (let i = 0; i < data.length; i++) {
      const cur  = data[i][key]       ?? null;
      const prev = data[i - 1]?.[key] ?? null;
      const next = data[i + 1]?.[key] ?? null;
      // Toute valeur null adjacente à une valeur réelle → 0
      if (cur === null && (prev !== null || next !== null)) {
        result[i][key] = 0;
      }
    }
  }
  return result;
}

// ── Chart grid: expand hides others, expands active ───────────────────────────
export function ChartGrid({charts}:{charts:{key:string;title:string;node:(h:number,isExp:boolean)=>ReactNode;onResetZoom?:()=>void;brushActive?:boolean}[]}) {
  const [exp,setExp]=useState<string|null>(null);
  return(
    <div style={{display:"grid",gridTemplateColumns:exp?"1fr":"repeat(auto-fit,minmax(280px,1fr))",gap:16,padding:20}}>
      {charts.map(c=>{
        const isExp=exp===c.key;
        if(exp&&!isExp)return null;
        const h=isExp?520:260;
        return(
          <div key={c.key} className="chart-card" style={{margin:0,height:h+52,overflow:"hidden"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div className="chart-title">{c.title}</div>
              <div style={{display:"flex",gap:4,alignItems:"center"}}>
                {c.onResetZoom&&(
                  <button className="btn btn-ghost btn-sm" style={{fontSize:10,opacity:c.brushActive?1:0.35,cursor:c.brushActive?"pointer":"default"}}
                    onClick={()=>c.brushActive&&c.onResetZoom?.()}
                    title="Réinitialiser le zoom">↺</button>
                )}
                <button className="btn btn-ghost btn-sm" style={{fontSize:10}}
                  onClick={()=>setExp(v=>v===c.key?null:c.key)}>
                  {isExp?"-":"+"}
                </button>
              </div>
            </div>
            <div style={{height:h,overflow:"hidden"}}>{c.node(h,isExp)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Nested Pie ─────────────────────────────────────────────────────────────────
export function NestedPie({inner,outer,total,fmt,toggleLabel,onToggle,h=260}:{
  inner:{name:string;value:number;color:string;opacity?:number;isNeg?:boolean}[];
  outer:{name:string;value:number;rawValue?:number;color:string;group?:string;opacity?:number;isNeg?:boolean}[];
  total:number;fmt:(n:number)=>string;toggleLabel?:string;onToggle?:()=>void;h?:number;
}) {
  const [selectedGroup,setSelectedGroup]=useState<string|null>(null);
  // Outer-ring filter: click an outer segment to highlight all segments sharing the same subcat name
  const [selectedOuterName,setSelectedOuterName]=useState<string|null>(null);

  // Order outer segments to match inner ring order (so each outer arc aligns with its inner arc)
  const innerOrder=Object.fromEntries(inner.map((e,i)=>[e.name,i]));
  const orderedOuter=[...outer].sort((a,b)=>{
    const ia=innerOrder[a.group??a.name]??999;
    const ib=innerOrder[b.group??b.name]??999;
    return ia-ib;
  });

  // Active filter: inner-group click OR outer-name click (mutually exclusive)
  const filteredOuter=selectedGroup
    ?orderedOuter.filter(o=>o.group===selectedGroup)
    :selectedOuterName
    ?orderedOuter.filter(o=>o.name===selectedOuterName)
    :orderedOuter;

  // When outer-name is selected, recompute inner ring as each group's share of that subcat
  const displayInner=selectedOuterName
    ?inner
        .map(e=>({...e,value:filteredOuter.filter(o=>o.group===e.name).reduce((s,o)=>s+o.value,0)}))
        .filter(e=>e.value>0)
    :inner;

  const CT=({active,payload}:any)=>{
    if(!active||!payload?.length)return null;
    const p=payload[0];
    const isNeg=p.payload?.isNeg===true;
    const posOuter=filteredOuter.filter(o=>!o.isNeg);
    const ref=(selectedGroup||selectedOuterName)?posOuter.reduce((s,o)=>s+o.value,0):total;
    return(
      <div style={{...TOOLTIP_STYLE,padding:"8px 12px"}}>
        <div style={{color:"var(--text-0)",fontWeight:500,marginBottom:4}}>
          {isNeg?`↓ ${p.name}`:p.name}
        </div>
        {p.payload?.group&&p.payload.group!==p.name&&(
          <div style={{color:"var(--text-2)",fontSize:10,marginBottom:3}}>{p.payload.group}</div>
        )}
        <div style={{color:isNeg?"var(--rose)":"var(--teal)"}}>
          {isNeg?`− ${fmt(Math.abs(p.payload?.rawValue??p.value))}`:`+ ${fmt(p.payload?.rawValue??p.value)}`}
        </div>
        {!isNeg&&ref>0&&<div style={{color:"var(--text-1)",fontSize:10,marginTop:2}}>{((p.value/ref)*100).toFixed(1)} %</div>}
      </div>
    );
  };
  const ir=Math.round(h*0.21), or1=Math.round(h*0.32), ir2=or1, or2=Math.round(h*0.42);
  return(
    <div style={{position:"relative",height:h}}>
      {toggleLabel&&(
        <button className="btn btn-ghost btn-sm" style={{position:"absolute",top:0,right:0,zIndex:10,fontSize:10}}
          onClick={e=>{e.stopPropagation();onToggle?.();}}>{toggleLabel}</button>
      )}
      <ResponsiveContainer width="100%" height={h}>
        <PieChart>
          {/* ── Inner ring: click to filter outer by group ── */}
          <Pie data={displayInner} cx="50%" cy="50%" innerRadius={ir} outerRadius={or1} paddingAngle={0} dataKey="value"
            style={{cursor:"pointer"}}
            onClick={(_:any,index:number)=>{
              const name=displayInner[index]?.name;
              if(!name)return;
              setSelectedOuterName(null); // clear outer-name filter
              setSelectedGroup(v=>v===name?null:name);
            }}>
            {displayInner.map((e,i)=>(
              <Cell key={i} fill={e.color} stroke="var(--bg-1)"
                strokeWidth={selectedGroup===e.name?3:2}
                opacity={(selectedGroup&&selectedGroup!==e.name)?0.15:(e.opacity??1)}/>
            ))}
          </Pie>
          {/* ── Outer ring: click to filter by subcat name across all groups ── */}
          <Pie data={filteredOuter} cx="50%" cy="50%" innerRadius={ir2} outerRadius={or2} paddingAngle={0} dataKey="value"
            style={{cursor:"pointer"}}
            onClick={(_:any,index:number)=>{
              const name=filteredOuter[index]?.name;
              if(!name)return;
              setSelectedGroup(null); // clear inner-group filter
              setSelectedOuterName(v=>v===name?null:name);
            }}>
            {filteredOuter.map((e,i)=>(
              <Cell key={i} fill={e.color} stroke="var(--bg-1)"
                strokeWidth={selectedOuterName===e.name?2.5:1}
                opacity={e.opacity??1}/>
            ))}
          </Pie>
          <Tooltip content={<CT/>}/>
          <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle"
            style={{fontFamily:"Playfair Display",fontSize:Math.max(11,Math.round(h*0.055)),fill:"var(--text-0)"}}>
            {fmt(total)}
          </text>
          <text x="50%" y="56%" textAnchor="middle" dominantBaseline="middle"
            style={{fontFamily:"JetBrains Mono",fontSize:8,fill:"var(--text-2)",letterSpacing:"0.08em"}}>
            TOTAL
          </text>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Active dot that hides zero/null values (bell-effect) ──────────────────────
export const activeDotNoZero = (props: any) => {
  if (!props.value) return <g/>;
  const { cx, cy, fill, stroke } = props;
  return <circle cx={cx} cy={cy} r={4} fill={fill ?? stroke} stroke="white" strokeWidth={1.5}/>;
};

// ── Accordion section ──────────────────────────────────────────────────────────
export function AccordionSection({label,count,color,children}:{label:string;count:number;color?:string;children:ReactNode}) {
  const [open,setOpen]=useState(false);
  return(
    <div style={{borderTop:"1px solid var(--border)"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 20px",cursor:"pointer",userSelect:"none"}}
        onClick={()=>setOpen(v=>!v)}>
        <span style={{fontSize:10,transform:open?"rotate(90deg)":"none",display:"inline-block",transition:"transform .15s",color:"var(--text-2)"}}>▶</span>
        <span style={{fontSize:10,letterSpacing:".1em",textTransform:"uppercase",color:color??"var(--text-2)"}}>{label}</span>
        <span style={{fontSize:10,color:"var(--text-2)",marginLeft:4}}>({count})</span>
      </div>
      {open&&children}
    </div>
  );
}
