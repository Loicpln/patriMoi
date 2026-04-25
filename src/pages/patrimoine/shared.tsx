// ── Shared UI components for Patrimoine ───────────────────────────────────────
import { useState, useEffect, useMemo, Component, ReactNode } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from "recharts";
import { TOOLTIP_STYLE } from "../../constants";

// ── Day Selector hook ─────────────────────────────────────────────────────────
/** Auto-initialises to last day of month (or today if current month).
 *  Auto-resets via useEffect whenever mois changes. */
export function useDaySelector(mois: string) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  useEffect(() => {
    const todayFull = new Date().toISOString().slice(0, 10);
    const curMois = todayFull.slice(0, 7);
    if (mois === curMois) {
      setSelectedDay(parseInt(todayFull.slice(8, 10)));
    } else {
      const [y, m] = mois.split('-').map(Number);
      setSelectedDay(new Date(y, m, 0).getDate());
    }
  }, [mois]);
  const displayDate = useMemo(() =>
    selectedDay ? `${mois}-${String(selectedDay).padStart(2, '0')}` : `${mois}-31`,
  [mois, selectedDay]);
  return { selectedDay, setSelectedDay, displayDate };
}

// ── Day picker columns (expanded-pie calendar sidebar) ─────────────────────────
// Each side shows half the month as a 2-column grid of square day buttons
// that fill the full available height h.
export function DayColumns({ mois, selectedDay, setSelectedDay, children, h }: {
  mois: string; selectedDay: number | null;
  setSelectedDay: (d: number | null) => void;
  children: ReactNode; h: number;
}) {
  const year = parseInt(mois.slice(0, 4));
  const month = parseInt(mois.slice(5, 7));
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayFull = new Date().toISOString().slice(0, 10);
  const maxDay = mois === todayFull.slice(0, 7) ? parseInt(todayFull.slice(8, 10)) : daysInMonth;
  const mid = Math.ceil(daysInMonth / 2);
  const leftDays  = Array.from({ length: mid },               (_, i) => i + 1);
  const rightDays = Array.from({ length: daysInMonth - mid }, (_, i) => mid + i + 1);

  // 2 columns per side → number of rows = ceil(halfDays / 2)
  const gap = 2;
  const numRowsL = Math.ceil(mid / 2);
  const numRowsR = Math.ceil((daysInMonth - mid) / 2);
  // Square button size: fill height h with numRows rows + gaps between them
  const btnSzL = Math.floor((h - 2 * gap * (numRowsL - 1)) / numRowsL);
  const btnSzR = Math.floor((h - 2 * gap * (numRowsR - 1)) / numRowsR);
  const fszL = Math.max(9, Math.min(18, Math.floor(btnSzL * 0.38)));
  const fszR = Math.max(9, Math.min(18, Math.floor(btnSzR * 0.38)));

  const dayBtn = (d: number, sz: number, fsz: number) => {
    const disabled = d > maxDay;
    const active = selectedDay === d;
    return (
      <button key={d} disabled={disabled}
        onClick={() => !disabled && setSelectedDay(selectedDay === d ? null : d)}
        style={{
          width: sz, height: sz, padding: 0, flexShrink: 0,
          border: active ? '2px solid var(--gold)' : '1px solid var(--border)',
          background: active ? 'var(--gold)' : 'var(--bg-2)',
          color: disabled ? 'var(--text-3)' : active ? 'var(--bg-0)' : 'var(--text-1)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'var(--mono)', fontSize: fsz, borderRadius: 3,
          opacity: disabled ? 0.3 : 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{d}</button>
    );
  };

  return (
    <div style={{ display: 'flex', height: h, alignItems: 'center', gap: 6 }}>
      {/* Left side: days 1–mid in a 2-col square grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(2, ${btnSzL}px)`,
        gap,
        flexShrink: 0,
        paddingRight: 4,
      }}>
        {leftDays.map(d => dayBtn(d, btnSzL, fszL))}
      </div>
      {/* Center: date label + pie */}
      <div style={{ flex: 1, minWidth: 0, height: '100%', position: 'relative' }}>
        {selectedDay && (
          <div style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)',
            fontSize: 9, color: 'var(--gold)', fontFamily: 'var(--mono)',
            zIndex: 1, whiteSpace: 'nowrap', letterSpacing: '.04em',
            background: 'var(--bg-2)', padding: '1px 6px', borderRadius: 4 }}>
            {mois}-{String(selectedDay).padStart(2, '0')}
          </div>
        )}
        {children}
      </div>
      {/* Right side: days mid+1–end in a 2-col square grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(2, ${btnSzR}px)`,
        gap,
        flexShrink: 0,
        paddingLeft: 4,
      }}>
        {rightDays.map(d => dayBtn(d, btnSzR, fszR))}
      </div>
    </div>
  );
}

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
export function NestedPie({inner,outer,total,fmt,toggleLabel,onToggle,h=260,signedValues=false}:{
  inner:{name:string;value:number;color:string;opacity?:number;isNeg?:boolean}[];
  outer:{name:string;value:number;rawValue?:number;color:string;group?:string;opacity?:number;isNeg?:boolean}[];
  total:number;fmt:(n:number)=>string;toggleLabel?:string;onToggle?:()=>void;h?:number;signedValues?:boolean;
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
    const isNeg=signedValues&&p.payload?.isNeg===true;
    const posOuter=filteredOuter.filter(o=>!o.isNeg);
    const ref=(selectedGroup||selectedOuterName)?posOuter.reduce((s,o)=>s+o.value,0):total;
    const dispVal=p.payload?.rawValue!==undefined?Math.abs(p.payload.rawValue):p.value;
    return(
      <div style={{...TOOLTIP_STYLE,padding:"8px 12px"}}>
        <div style={{color:"var(--text-0)",fontWeight:500,marginBottom:4}}>
          {signedValues?(isNeg?`↓ ${p.name}`:`↑ ${p.name}`):p.name}
        </div>
        {p.payload?.group&&p.payload.group!==p.name&&(
          <div style={{color:"var(--text-2)",fontSize:10,marginBottom:3}}>{p.payload.group}</div>
        )}
        <div style={{color:isNeg?"var(--rose)":signedValues?"var(--teal)":"var(--gold)"}}>
          {isNeg?`− ${fmt(dispVal)}`:signedValues?`+ ${fmt(dispVal)}`:fmt(p.value)}
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
