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

// ── Chart grid: expand hides others, expands active ───────────────────────────
export function ChartGrid({charts}:{charts:{key:string;title:string;node:(h:number)=>ReactNode}[]}) {
  const [exp,setExp]=useState<string|null>(null);
  return(
    <div style={{display:"grid",gridTemplateColumns:exp?"1fr":"repeat(auto-fit,minmax(280px,1fr))",gap:16,padding:20}}>
      {charts.map(c=>{
        const isExp=exp===c.key;
        if(exp&&!isExp)return null;
        const h=isExp?520:260;
        return(
          <div key={c.key} className="chart-card" style={{margin:0,height:h+52}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div className="chart-title" style={{marginBottom:0,fontSize:12}}>{c.title}</div>
              <button className="btn btn-ghost btn-sm" style={{fontSize:10}}
                onClick={()=>setExp(v=>v===c.key?null:c.key)}>
                {isExp?"⊟ Réduire":"⊞ Agrandir"}
              </button>
            </div>
            <div style={{height:h}}>{c.node(h)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Nested Pie ─────────────────────────────────────────────────────────────────
export function NestedPie({inner,outer,total,fmt,toggleLabel,onToggle,h=260}:{
  inner:{name:string;value:number;color:string}[];
  outer:{name:string;value:number;color:string}[];
  total:number;fmt:(n:number)=>string;toggleLabel:string;onToggle:()=>void;h?:number;
}) {
  const CT=({active,payload}:any)=>{
    if(!active||!payload?.length)return null;
    const p=payload[0];
    return(
      <div style={{...TOOLTIP_STYLE,padding:"8px 12px"}}>
        <div style={{color:"var(--text-0)",fontWeight:500,marginBottom:4}}>{p.name}</div>
        <div style={{color:"var(--gold)"}}>{fmt(p.value)}</div>
        {total>0&&<div style={{color:"var(--text-1)",fontSize:10,marginTop:2}}>{((p.value/total)*100).toFixed(1)} %</div>}
      </div>
    );
  };
  const ir=Math.round(h*0.21), or1=Math.round(h*0.32), ir2=Math.round(h*0.34), or2=Math.round(h*0.42);
  return(
    <div style={{position:"relative",height:h}}>
      <button className="btn btn-ghost btn-sm" style={{position:"absolute",top:0,right:0,zIndex:10,fontSize:10}}
        onClick={e=>{e.stopPropagation();onToggle();}}>{toggleLabel}</button>
      <ResponsiveContainer width="100%" height={h}>
        <PieChart>
          <Pie data={inner} cx="50%" cy="50%" innerRadius={ir} outerRadius={or1} paddingAngle={0} dataKey="value">
            {inner.map((e,i)=><Cell key={i} fill={e.color} stroke="var(--bg-1)" strokeWidth={2}/>)}
          </Pie>
          <Pie data={outer} cx="50%" cy="50%" innerRadius={ir2} outerRadius={or2} paddingAngle={0} dataKey="value">
            {outer.map((e,i)=><Cell key={i} fill={e.color} stroke="var(--bg-1)" strokeWidth={1}/>)}
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
