import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, ComposedChart,
  Bar, BarChart, Cell, Brush, Customized, ReferenceArea,
} from "recharts";
import { useDevise } from "../../context/DeviseContext";
import { LIVRETS_DEF, TOOLTIP_ITEM_STYLE, TOOLTIP_LABEL_STYLE, TOOLTIP_STYLE } from "../../constants";
import { ChartGrid, NestedPie, AccordionSection, bellEffect, activeDotNoZero } from "./shared";
import { LivretPocheFormModal, LivretPocheEditModal, OpLivretModal } from "./modals";
import { ExportBtn, ImportBtn, ImportModal, exportLivretPoche,
  importLivretOps, exportLivretsBatch, type ImportPending } from "./InvestSettings";
import type { Livret, LivretPoche } from "./types";

const MN_SHORT = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

const PAGE_SIZE = 10;
function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, padding:"6px 4px", userSelect:"none" }}>
      <button className="btn btn-ghost btn-sm" disabled={page===0} onClick={()=>onPage(0)} style={{ padding:"2px 6px", fontSize:11 }}>«</button>
      <button className="btn btn-ghost btn-sm" disabled={page===0} onClick={()=>onPage(page-1)} style={{ padding:"2px 6px", fontSize:11 }}>‹</button>
      <span style={{ fontSize:10, color:"var(--text-2)", minWidth:60, textAlign:"center" }}>{page+1} / {pages}</span>
      <button className="btn btn-ghost btn-sm" disabled={page>=pages-1} onClick={()=>onPage(page+1)} style={{ padding:"2px 6px", fontSize:11 }}>›</button>
      <button className="btn btn-ghost btn-sm" disabled={page>=pages-1} onClick={()=>onPage(pages-1)} style={{ padding:"2px 6px", fontSize:11 }}>»</button>
    </div>
  );
}

function idxPx(data: any[], x1: string, x2: string, offset: any, bStart = 0, bEnd?: number) {
  const end = bEnd ?? data.length - 1;
  const N = end - bStart + 1;
  if (N <= 0) return null;
  const ai1 = data.findIndex((d: any) => d.date === x1);
  let ai2 = -1; for (let i = data.length - 1; i >= 0; i--) { if ((data[i] as any).date === x2) { ai2 = i; break; } }
  if (ai1 < 0 || ai2 < 0) return null;
  const r1 = Math.max(0, ai1 - bStart); const r2 = Math.min(N - 1, ai2 - bStart);
  if (r2 < 0 || r1 >= N) return null;
  const denom = Math.max(1, N - 1);
  const step = N > 1 ? offset.width / (N - 1) : offset.width;
  return { rx1: offset.left + (r1 / denom) * offset.width, rx2: offset.left + (r2 / denom) * offset.width, step };
}

// ── Bar cursor: thin vertical line ───────────────────────────────────────────
const BarLineCursor = ({ x = 0, y = 0, width = 0, height = 0 }: any) => (
  <line x1={x + width / 2} y1={y} x2={x + width / 2} y2={y + height}
    stroke="var(--text-0)" strokeWidth={1}/>
);

// ── Helpers ───────────────────────────────────────────────────────────────────
const isInteret = (l: Livret) => (l.notes ?? "").startsWith("[INTERET");
const keyId = (type_livret: string, nom: string) =>
  `${type_livret}_${nom}`.replace(/[^a-zA-Z0-9_-]/g, "_");
const extractYear = (l: Livret): number => {
  const m = (l.notes ?? "").match(/\[INTERET (\d{4})\]/);
  return m ? parseInt(m[1]) : parseInt(l.date.slice(0, 4));
};
const computeBalance = (ops: Livret[]) =>
  ops.reduce((s, o) => s + o.montant, 0);

// ── Daily cumulative data for one livret ──────────────────────────────────────
function buildDailyData(ops: Livret[], key: string): any[] {
  const sorted = ops.sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return [];
  const dates: string[] = [];
  const cur = new Date(sorted[0].date);
  const now = new Date(); now.setHours(23, 59, 59, 999);
  while (cur <= now) { dates.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1); }
  let idx = 0, running = 0;
  const raw = dates.map(d => {
    while (idx < sorted.length && sorted[idx].date <= d) running += sorted[idx++].montant;
    return { date: d, [key]: running > 0 ? running : null };
  });
  return bellEffect(raw, [key]);
}

// ── Global stacked daily data ─────────────────────────────────────────────────
function buildGlobalDailyData(livrets: Livret[], livretPoches: LivretPoche[]): any[] {
  if (!livretPoches.length) return [];
  let firstDate = "";
  livretPoches.forEach(p =>
    livrets.filter(l => l.poche === p.type_livret && l.nom === p.nom)
      .forEach(o => { if (!firstDate || o.date < firstDate) firstDate = o.date; })
  );
  if (!firstDate) return [];
  const dates: string[] = [];
  const tmp = new Date(firstDate);
  const now = new Date(); now.setHours(23, 59, 59, 999);
  while (tmp <= now) { dates.push(tmp.toISOString().slice(0, 10)); tmp.setDate(tmp.getDate() + 1); }

  const ops:    Record<string, Livret[]> = {};
  const idx:    Record<string, number>   = {};
  const val:    Record<string, number>   = {};
  const active: Record<string, boolean>  = {};
  livretPoches.forEach(p => {
    const k = keyId(p.type_livret, p.nom);
    ops[k]    = livrets.filter(l => l.poche === p.type_livret && l.nom === p.nom)
                  .sort((a, b) => a.date.localeCompare(b.date));
    idx[k] = 0; val[k] = 0; active[k] = false;
  });
  const keys = livretPoches.map(p => keyId(p.type_livret, p.nom));
  const raw = dates.map(d => {
    const row: any = { date: d };
    livretPoches.forEach(p => {
      const k = keyId(p.type_livret, p.nom);
      while (idx[k] < ops[k].length && ops[k][idx[k]].date <= d) {
        val[k] += ops[k][idx[k]++].montant; active[k] = true;
      }
      row[k] = active[k] ? (val[k] > 0 ? val[k] : null) : null;
    });
    return row;
  });
  return bellEffect(raw, keys);
}

// ── Per-livret poche accordion ────────────────────────────────────────────────
function LivretPocheSection({
  poche, ops, mois, onAdd, onDeleteOp, onDelete, onEdit, onImportParsed,
}: {
  poche:         LivretPoche;
  ops:           Livret[];
  mois:          string;
  onAdd:         (op: "versement"|"retrait"|"interet") => void;
  onDeleteOp:    (id: number) => void;
  onDelete:      () => void;
  onEdit:        (nom: string, couleur: string) => void;
  onImportParsed:(rows: string[][], rowCount: number) => void;
}) {
  const { fmt, fmtAxis } = useDevise();
  const [open, setOpen]             = useState(false);
  const [headerMode, setHeaderMode] = useState<"actions"|"gestion">("actions");
  const [editModal, setEditModal]   = useState(false);

  const typeDef = LIVRETS_DEF.find(l => l.key === poche.type_livret);
  const color   = poche.couleur || typeDef?.color || "#F0BD40";
  const kid     = keyId(poche.type_livret, poche.nom);
  const annee   = parseInt(mois.slice(0, 4));

  const balance          = useMemo(() => computeBalance(ops), [ops]);
  const balanceAtMois    = useMemo(() =>
    ops.filter(o => o.date.slice(0, 7) <= mois)
       .reduce((s, o) => s + o.montant, 0),
  [ops, mois]);
  const interestsMap     = useMemo(() => {
    const m: Record<number, number> = {};
    ops.filter(isInteret).forEach(o => { const y = extractYear(o); m[y] = (m[y] ?? 0) + o.montant; });
    return m;
  }, [ops]);
  const interestThisYear = interestsMap[annee] ?? 0;

  const dailyData  = useMemo(() => buildDailyData(ops, kid), [ops, kid]);
  const annualData = useMemo(() => {
    const years = Object.keys(interestsMap).map(Number).sort();
    return years.map(y => ({ year: String(y), montant: interestsMap[y] }));
  }, [interestsMap]);

  const [brushIdx, setBrushIdx] = useState<{ start: number; end: number } | null>(null);
  const visibleData = useMemo(() =>
    brushIdx ? dailyData.slice(brushIdx.start, brushIdx.end + 1) : dailyData,
  [dailyData, brushIdx]);
  const onBrushChange = (range: any) => {
    const s = range?.startIndex ?? 0; const e = range?.endIndex ?? dailyData.length - 1;
    setBrushIdx(s === 0 && e === dailyData.length - 1 ? null : { start: s, end: e });
  };
  const monthRange = useMemo(() => {
    const inM = visibleData.filter((d: any) => (d.date as string).slice(0, 7) === mois);
    if (!inM.length) return null;
    return { x1: inM[0].date as string, x2: inM[inM.length - 1].date as string };
  }, [visibleData, mois]);

  const xTicks = useMemo(() => {
    const seen = new Set<string>(), firsts: string[] = [];
    visibleData.forEach((d: any) => {
      const m = (d.date as string).slice(0, 7);
      if (!seen.has(m)) { seen.add(m); firsts.push(d.date as string); }
    });
    return firsts.filter((_, i) => i % Math.max(1, Math.ceil(firsts.length / 6)) === 0);
  }, [visibleData]);
  const opsSorted = useMemo(() => [...ops].sort((a, b) => b.date.localeCompare(a.date)), [ops]);

  type OpType = "versement" | "retrait" | "interet";
  const [filterTypes, setFilterTypes] = useState<Set<OpType>>(new Set());
  const [pageOps, setPageOps] = useState(0);

  const getOpType = (o: Livret): OpType =>
    isInteret(o) ? "interet" : o.montant < 0 ? "retrait" : "versement";

  const filteredOps = useMemo(() => {
    if (!filterTypes.size) return opsSorted;
    return opsSorted.filter(o => filterTypes.has(getOpType(o)));
  }, [opsSorted, filterTypes]);

  const countByType = useMemo(() => {
    const m: Record<OpType, number> = { versement: 0, retrait: 0, interet: 0 };
    opsSorted.forEach(o => { m[getOpType(o)]++; });
    return m;
  }, [opsSorted]);

  const togType = (t: OpType) => {
    setFilterTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
    setPageOps(0);
  };

  // ── Chart nodes ────────────────────────────────────────────────────────────
  const balanceNode = (h: number, isExp: boolean) => !dailyData.length
    ? <div className="empty">Aucune opération</div>
    : (
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={dailyData} margin={{ left:0, right:5, top:5, bottom: isExp ? 28 : 0 }}>
          <defs>
            <linearGradient id={`gb_${kid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.55}/>
              <stop offset="95%" stopColor={color} stopOpacity={0.04}/>
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
          <XAxis dataKey="date" ticks={xTicks} tick={{ fontSize:8, fontFamily:"JetBrains Mono" }}
            tickFormatter={d => MN_SHORT[parseInt(d.slice(5,7))-1]+" "+d.slice(2,4)}/>
          <YAxis tick={{ fontSize:8, fontFamily:"JetBrains Mono" }} tickFormatter={fmtAxis} width={32}/>
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color:"var(--text-2)", fontSize:9 }}
            formatter={(v:any) => [fmt(Number(v)), "Solde"]}/>
          <Area type="stepAfter" dataKey={kid} name="Solde"
            stroke={color} strokeWidth={1.5} fill={`url(#gb_${kid})`}
            dot={false} activeDot={activeDotNoZero}/>
          {monthRange && (
            <Customized component={(p: any) => {
              const bS = isExp ? (brushIdx?.start ?? 0) : 0;
              const bE = isExp ? (brushIdx?.end ?? dailyData.length - 1) : dailyData.length - 1;
              const r = idxPx(dailyData, monthRange.x1, monthRange.x2, p.offset, bS, bE);
              if (!r) return null;
              return <g><rect x={r.rx1} y={p.offset.top}
                width={Math.max(1, r.rx2 - r.rx1 + r.step)} height={p.offset.height}
                fill="var(--gold)" fillOpacity={0.15} stroke="var(--gold)" strokeOpacity={0.5}
                strokeDasharray="4 2" strokeWidth={1} pointerEvents="none"/></g>;
            }}/>
          )}
          {isExp && (
            <Brush dataKey="date" height={22} travellerWidth={6}
              stroke="var(--border)" fill="var(--bg-2)"
              startIndex={brushIdx?.start ?? 0}
              endIndex={brushIdx?.end ?? dailyData.length - 1}
              onChange={onBrushChange} tickFormatter={() => ""}/>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    );

  const interestNode = (h: number) => !annualData.length
    ? <div className="empty">Aucun intérêt enregistré</div>
    : (
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={annualData} margin={{ left:0, right:5, top:5, bottom:0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
          <XAxis dataKey="year" tick={{ fontSize:8, fontFamily:"JetBrains Mono" }}/>
          <YAxis tick={{ fontSize:8, fontFamily:"JetBrains Mono" }} tickFormatter={fmtAxis} width={32}/>
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color:"var(--text-2)", fontSize:9 }}
            itemStyle={{ color }} formatter={(v:any) => [fmt(Number(v)), "Intérêts"]}
            cursor={<BarLineCursor/>}/>
          {annualData.some(d => d.year === String(annee)) && (
            <ReferenceArea x1={String(annee)} x2={String(annee)}
              fill="var(--gold)" fillOpacity={0.15}
              stroke="var(--gold)" strokeOpacity={0.5}
              strokeDasharray="4 2" strokeWidth={1}/>
          )}
          <Bar dataKey="montant" name="Intérêts" radius={[0,0,0,0]}>
            {annualData.map((d,i) => (
              <Cell key={i} fill={color}/>
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="table-card" style={{ marginBottom:12 }}>
      {/* Header — same structure as PocheSection */}
      <div className="poche-header" onClick={() => setOpen(v => !v)}
        style={{ cursor:"pointer", userSelect:"none" }}>
        {/* Left: chevron + color bar + type badge + name + value */}
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:10, transform:open?"rotate(90deg)":"none",
            display:"inline-block", transition:"transform .2s", color:"var(--text-2)" }}>▶</span>
          <span className="poche-title" style={{ color }}>{poche.nom}</span>
          <span style={{ fontSize:10, background:color+"22", color, padding:"1px 6px",
            borderRadius:4, fontFamily:"var(--mono)" }}>
            {typeDef?.label ?? poche.type_livret}
          </span>
          <span style={{ fontSize:11, color:"var(--text-1)" }}>
            {fmt(balanceAtMois)}
            {interestThisYear > 0 && (
              <span style={{ color:"var(--gold)", marginLeft:6 }}>
                +{fmt(interestThisYear)}
              </span>
            )}
          </span>
        </div>

        {/* Right: action/gestion buttons + ⚙ toggle */}
        <div style={{ display:"flex", gap:6, alignItems:"center" }}
          onClick={e => e.stopPropagation()}>
          {headerMode === "actions" && (<>
            <button className="btn btn-ghost btn-sm" onClick={() => onAdd("versement")}>+ Versement</button>
            <button className="btn btn-danger btn-sm" onClick={() => onAdd("retrait")}>- Retrait</button>
            <button className="btn btn-primary btn-sm" onClick={() => onAdd("interet")}>+ Intérêts</button>
          </>)}
          {headerMode === "gestion" && <>
            <ExportBtn label={`${poche.nom}.csv`}
              onExport={() => exportLivretPoche(poche.type_livret, poche.nom)}/>
            <ImportBtn label={poche.nom} onParsed={onImportParsed}/>
            <button className="btn btn-ghost btn-sm" style={{ fontSize:10 }}
              onClick={() => setEditModal(true)} title="Modifier le livret">✎</button>
            <button className="btn btn-danger btn-sm" style={{ fontSize:10 }}
              onClick={onDelete} title="Supprimer le livret">✕</button>
          </>}
          <span style={{ width:1, height:16, background:"var(--border)", display:"inline-block", margin:"0 2px" }}/>
          <button
            className={`btn btn-sm ${headerMode==="gestion"?"btn-primary":"btn-ghost"}`}
            style={{ fontSize:12, padding:"2px 7px" }}
            onClick={() => setHeaderMode(m => m==="actions"?"gestion":"actions")}
            title={headerMode==="actions"?"Gestion (import/export/modifier/supprimer)":"Actions (+ opération)"}
          >⚙</button>
        </div>
      </div>

      {/* Body */}
      {open && (
        <div>
          <ChartGrid charts={[
            { key:`${kid}_bal`, title:"Évolution du solde / jour", node:balanceNode,
              brushActive:!!brushIdx, onResetZoom:()=>setBrushIdx(null) },
            { key:`${kid}_int`, title:"Intérêts annuels",          node:interestNode },
          ]}/>

          <AccordionSection label="Opérations" count={opsSorted.length}>
            {!opsSorted.length ? <div className="empty">Aucune opération</div> : (<>
              {/* Filtres par type */}
              <div style={{ display:"flex", alignItems:"center", gap:6, marginInline:4, flexWrap:"wrap", marginBottom:4, padding:"4px 0" }}>
                <button className="btn btn-sm" style={{ fontSize:10, padding:"2px 8px",
                    background: filterTypes.size===0 ? "var(--bg-0)" : "transparent",
                    color: filterTypes.size===0 ? "var(--text-0)" : "var(--text-2)",
                    borderColor: filterTypes.size===0 ? "var(--text-2)" : "var(--border)",
                    fontWeight: filterTypes.size===0 ? 600 : 400 }}
                  onClick={() => { setFilterTypes(new Set()); setPageOps(0); }}>Tout</button>
                {([ ["versement","Versement","var(--teal)"], ["retrait","Retrait","var(--rose)"], ["interet","Intérêts","var(--gold)"] ] as [OpType,string,string][]).map(([t, label, c]) => {
                  const active = filterTypes.has(t);
                  return (
                    <button key={t} className="btn btn-sm"
                      style={{ fontSize:10, padding:"2px 8px",
                        color: active ? c : "var(--text-2)",
                        borderColor: active ? c : "var(--border)",
                        background: active ? c+"33" : "transparent",
                        fontWeight: active ? 600 : 400 }}
                      onClick={() => togType(t)}>
                      {label} ({countByType[t]})
                    </button>
                  );
                })}
              </div>
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Montant</th><th>Notes</th><th/></tr></thead>
                <tbody>
                  {filteredOps.slice(pageOps * PAGE_SIZE, (pageOps + 1) * PAGE_SIZE).map(o => {
                    const t       = getOpType(o);
                    const lcolor  = t === "interet" ? "var(--gold)" : t === "retrait" ? "var(--rose)" : "var(--teal)";
                    const label   = t === "interet" ? `Intérêts ${extractYear(o)}` : t === "retrait" ? "Retrait" : "Versement";
                    const note    = t === "interet" ? (o.notes ?? "").replace(/\[INTERET \d+\]\s*/,"") : (o.notes ?? "");
                    return (
                      <tr key={o.id}>
                        <td style={{ color:"var(--text-1)" }}>{o.date}</td>
                        <td><span style={{ color:lcolor, fontSize:10 }}>{label}</span></td>
                        <td style={{ color: lcolor }}>
                          {t==="retrait" ? "−" : "+"}{fmt(Math.abs(o.montant))}
                        </td>
                        <td style={{ color:"var(--text-2)", fontSize:10 }}>{note}</td>
                        <td><button className="btn btn-danger btn-sm" onClick={() => onDeleteOp(o.id!)}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pager page={pageOps} total={filteredOps.length} onPage={p => setPageOps(p)}/>
            </>)}
          </AccordionSection>
        </div>
      )}
      {editModal && (
        <LivretPocheEditModal
          poche={poche}
          onSave={(nom, couleur) => { setEditModal(false); onEdit(nom, couleur); }}
          onClose={() => setEditModal(false)}
        />
      )}
    </div>
  );
}

// ── Main LivretsSection ───────────────────────────────────────────────────────
export function LivretsSection({
  livrets, livretPoches, mois, onRefresh, viewMode, onToggleView,
}: {
  livrets: Livret[]; livretPoches: LivretPoche[]; mois: string; onRefresh: () => void;
  viewMode: "graphiques"|"livrets"; onToggleView: () => void;
}) {
  const { fmt, fmtAxis } = useDevise();

  // Modals
  const [pocheFormOpen,   setPocheFormOpen]   = useState(false);
  const [addOpTarget,     setAddOpTarget]      = useState<{poche:LivretPoche;op:"versement"|"retrait"|"interet"}|null>(null);
  const [confirmDelete,   setConfirmDelete]    = useState<LivretPoche|null>(null);
  const [importPending,   setImportPending]    = useState<ImportPending|null>(null);

  const annee  = parseInt(mois.slice(0, 4));
  const newOps = useMemo(() => livrets.filter(l => l.nom !== ""), [livrets]);

  // Sort livretPoches by LIVRETS_DEF order (bottom → top: LDDS, Livret A, LEP, Livret Jeune)
  const defIdx = (type_livret: string) => {
    const i = LIVRETS_DEF.findIndex(l => l.key === type_livret);
    return i >= 0 ? i : 999;
  };
  const sortedPoches = useMemo(() =>
    [...livretPoches].sort((a, b) => defIdx(a.type_livret) - defIdx(b.type_livret) || a.nom.localeCompare(b.nom)),
  [livretPoches]);

  // Balance per poche at selected month
  const balanceMap = useMemo(() => {
    const m: Record<string, number> = {};
    livretPoches.forEach(p => {
      m[keyId(p.type_livret, p.nom)] = newOps
        .filter(o => o.poche === p.type_livret && o.nom === p.nom && o.date.slice(0, 7) <= mois)
        .reduce((s, o) => s + o.montant, 0);
    });
    return m;
  }, [newOps, livretPoches, mois]);

  const totalBalance   = Object.values(balanceMap).reduce((s, v) => s + v, 0);
  const totalInterests = useMemo(() =>
    newOps.filter(o => isInteret(o) && extractYear(o) === annee)
          .reduce((s, o) => s + o.montant, 0),
  [newOps, annee]);

  // Pie data: inner = type, outer = individual nom — both sorted by LIVRETS_DEF order
  const { pieInner, pieOuter } = useMemo(() => {
    const typeOrder: string[] = [];
    const typeMap: Record<string, number> = {};
    const outer: { name:string; value:number; color:string; group:string }[] = [];
    sortedPoches.forEach(p => {
      const val = balanceMap[keyId(p.type_livret, p.nom)] ?? 0;
      if (val <= 0) return;
      if (!typeMap[p.type_livret]) typeOrder.push(p.type_livret);
      typeMap[p.type_livret] = (typeMap[p.type_livret] ?? 0) + val;
      const typeDef = LIVRETS_DEF.find(l => l.key === p.type_livret);
      const c = p.couleur || typeDef?.color || "#F0BD40";
      outer.push({ name:p.nom, value:val, color:c, group:typeDef?.label??p.type_livret });
    });
    const inner = typeOrder.map(key => {
      const d = LIVRETS_DEF.find(l => l.key === key);
      return { name:d?.label??key, value:typeMap[key], color:d?.color??"#F0BD40" };
    });
    return { pieInner:inner, pieOuter:outer };
  }, [sortedPoches, balanceMap]);

  // Global stacked chart
  const globalData = useMemo(() =>
    buildGlobalDailyData(newOps, livretPoches), [newOps, livretPoches]);

  const [globalBrushIdx, setGlobalBrushIdx] = useState<{ start: number; end: number } | null>(null);
  const globalVisibleData = useMemo(() =>
    globalBrushIdx ? globalData.slice(globalBrushIdx.start, globalBrushIdx.end + 1) : globalData,
  [globalData, globalBrushIdx]);
  const onGlobalBrushChange = (range: any) => {
    const s = range?.startIndex ?? 0; const e = range?.endIndex ?? globalData.length - 1;
    setGlobalBrushIdx(s === 0 && e === globalData.length - 1 ? null : { start: s, end: e });
  };
  const globalMonthRange = useMemo(() => {
    const inM = globalVisibleData.filter((d: any) => (d.date as string).slice(0, 7) === mois);
    if (!inM.length) return null;
    return { x1: inM[0].date as string, x2: inM[inM.length - 1].date as string };
  }, [globalVisibleData, mois]);

  const globalXTicks = useMemo(() => {
    const seen = new Set<string>(), firsts: string[] = [];
    globalVisibleData.forEach((d: any) => {
      const m = (d.date as string).slice(0, 7);
      if (!seen.has(m)) { seen.add(m); firsts.push(d.date as string); }
    });
    return firsts.filter((_,i) => i % Math.max(1, Math.ceil(firsts.length/8)) === 0);
  }, [globalVisibleData]);

  const GlobalTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const items = payload.filter((p: any) => p.value != null && Number(p.value) > 0);
    if (!items.length) return null;
    const total = items.reduce((s: number, p: any) => s + Number(p.value), 0);
    return (
      <div style={{ ...TOOLTIP_STYLE, padding:"10px 14px", minWidth:160 }}>
        {label && <div style={{ color:"var(--text-2)", fontSize:9, marginBottom:6 }}>{label}</div>}
        <div style={{ display:"flex", justifyContent:"space-between", gap:12, marginBottom:6,
          paddingBottom:6, borderBottom:"1px solid var(--border)" }}>
          <span style={{ color:"var(--text-1)", fontSize:10 }}>Total</span>
          <span style={{ color:"var(--text-0)", fontSize:11, fontWeight:700 }}>{fmt(total)}</span>
        </div>
        {items.map((p: any, i: number) => (
          <div key={i} style={{ display:"flex", justifyContent:"space-between", gap:8, marginBottom:2 }}>
            <span style={{ color:p.stroke??"var(--text-1)", fontSize:10 }}>{p.name}</span>
            <span style={{ color:"var(--text-0)", fontSize:10 }}>{fmt(Number(p.value))}</span>
          </div>
        ))}
      </div>
    );
  };

  const pieNode = (h: number) => !pieInner.length
    ? <div className="empty">Aucun livret</div>
    : <NestedPie inner={pieInner} outer={pieOuter} total={totalBalance} fmt={fmt} h={h}/>;

  const stackNode = (h: number, isExp: boolean) => !globalData.length
    ? <div className="empty">Aucune donnée</div>
    : (
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={globalData} margin={{ left:0, right:5, top:5, bottom: isExp ? 28 : 0 }}>
          <defs>
            {sortedPoches.map(p => {
              const k = keyId(p.type_livret, p.nom);
              const c = p.couleur || LIVRETS_DEF.find(l => l.key === p.type_livret)?.color || "#F0BD40";
              return (
                <linearGradient key={k} id={`gg_${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={c} stopOpacity={0.55}/>
                  <stop offset="95%" stopColor={c} stopOpacity={0.04}/>
                </linearGradient>
              );
            })}
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}/>
          <XAxis dataKey="date" ticks={globalXTicks} tick={{ fontSize:8, fontFamily:"JetBrains Mono" }}
            tickFormatter={d => MN_SHORT[parseInt(d.slice(5,7))-1]+" "+d.slice(2,4)}/>
          <YAxis tick={{ fontSize:8, fontFamily:"JetBrains Mono" }} tickFormatter={fmtAxis} width={32}/>
          <Tooltip content={<GlobalTooltip/>}/>
          {sortedPoches.map(p => {
            const k = keyId(p.type_livret, p.nom);
            const c = p.couleur || LIVRETS_DEF.find(l => l.key === p.type_livret)?.color || "#F0BD40";
            return (
              <Area key={k} type="stepAfter" dataKey={k} stackId="a" name={p.nom}
                stroke={c} strokeWidth={1.5} fill={`url(#gg_${k})`}
                dot={false} activeDot={activeDotNoZero}/>
            );
          })}
          {globalMonthRange && (
            <Customized component={(p: any) => {
              const bS = isExp ? (globalBrushIdx?.start ?? 0) : 0;
              const bE = isExp ? (globalBrushIdx?.end ?? globalData.length - 1) : globalData.length - 1;
              const r = idxPx(globalData, globalMonthRange.x1, globalMonthRange.x2, p.offset, bS, bE);
              if (!r) return null;
              return <g><rect x={r.rx1} y={p.offset.top}
                width={Math.max(1, r.rx2 - r.rx1 + r.step)} height={p.offset.height}
                fill="var(--gold)" fillOpacity={0.15} stroke="var(--gold)" strokeOpacity={0.5}
                strokeDasharray="4 2" strokeWidth={1} pointerEvents="none"/></g>;
            }}/>
          )}
          {isExp && (
            <Brush dataKey="date" height={22} travellerWidth={6}
              stroke="var(--border)" fill="var(--bg-2)"
              startIndex={globalBrushIdx?.start ?? 0}
              endIndex={globalBrushIdx?.end ?? globalData.length - 1}
              onChange={onGlobalBrushChange} tickFormatter={() => ""}/>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    );

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleCreatePoche = async (p: LivretPoche) => {
    await invoke("add_livret_poche", { poche: p });
    setPocheFormOpen(false);
    onRefresh();
  };

  const handleDeletePoche = async () => {
    if (!confirmDelete) return;
    await invoke("delete_livret_poche", { typeLivret:confirmDelete.type_livret, nom:confirmDelete.nom });
    setConfirmDelete(null);
    onRefresh();
  };

  async function handleEditPoche(p: LivretPoche, nom: string, couleur: string) {
    if (!p.id) return;
    await invoke("update_livret_poche", { id: p.id, nom, couleur });
    onRefresh();
  }

  function makeImportHandler(p: LivretPoche) {
    return (rows: string[][], rowCount: number) => {
      setImportPending({
        label: p.nom, rowCount,
        onConfirm: async (replace) => { await importLivretOps(p.type_livret, p.nom)(rows, replace); onRefresh(); },
      });
    };
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Modals ── */}
      {importPending && <ImportModal pending={importPending} onClose={() => setImportPending(null)}/>}

      {pocheFormOpen && (
        <LivretPocheFormModal onSave={handleCreatePoche} onClose={() => setPocheFormOpen(false)}/>
      )}
      {addOpTarget && (
        <OpLivretModal poche={addOpTarget.poche} mois={mois} initialOp={addOpTarget.op}
          onClose={() => setAddOpTarget(null)}
          onSave={() => { setAddOpTarget(null); onRefresh(); }}/>
      )}
      {confirmDelete && (
        <div className="overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth:380 }}>
            <div className="modal-title" style={{ color:"var(--rose)" }}>Supprimer le livret</div>
            <p style={{ fontSize:12, color:"var(--text-1)", margin:"12px 0 24px" }}>
              Supprimer <strong>{confirmDelete.nom}</strong> et toutes ses opérations ?
              Cette action est irréversible.
            </p>
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Annuler</button>
              <button className="btn btn-danger" onClick={handleDeletePoche}>Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Section header — same layout as investments ── */}
      <div className="section-sep">
        <span className="section-sep-label">Livrets réglementés</span>
        <div className="section-sep-line"/>
        <ExportBtn label="↓ Livrets" onExport={() => exportLivretsBatch(livretPoches)}/>
        <button className="btn btn-primary btn-sm"
          onClick={() => setPocheFormOpen(true)}>
          + Livret
        </button>
        {/* Single toggle button — same pattern as investments */}
        <button
          className={`btn btn-sm ${viewMode==="livrets"?"btn-primary":"btn-ghost"}`}
          style={{ whiteSpace:"nowrap", fontSize:10 }}
          title={viewMode==="graphiques"?"Afficher les livrets":"Afficher les graphiques"}
          onClick={onToggleView}>
          {viewMode==="graphiques"?"Livrets":"Graphiques"}
        </button>
      </div>

      {!livretPoches.length ? (
        <div style={{ padding:"40px 20px", textAlign:"center", color:"var(--text-2)", fontSize:12 }}>
          Aucun livret · Cliquez sur <strong>+ Nouveau livret</strong> pour commencer
        </div>
      ) : (
        <>
          {/* ── Stat cards — toujours visibles ── */}
          <div style={{ display:"flex", gap:16, marginBottom:16, flexWrap:"wrap" }}>
            <div className="stat-card sc-lav" style={{ minWidth:160 }}>
              <div className="sc-label">Total · {mois}</div>
              <div className="sc-value">{fmt(totalBalance)}</div>
            </div>
            <div className="stat-card sc-gold" style={{ minWidth:160 }}>
              <div className="sc-label">Intérêts {annee}</div>
              <div className="sc-value" style={{ color:"var(--gold)" }}>
                {totalInterests > 0 ? fmt(totalInterests) : "—"}
              </div>
            </div>
          </div>

          {/* ── Graphiques view ── */}
          {viewMode === "graphiques" && (
            <ChartGrid charts={[
              { key:"liv_pie",   title:`Répartition · ${mois}`,     node:pieNode   },
              { key:"liv_stack", title:"Évolution globale par jour", node:stackNode,
                brushActive:!!globalBrushIdx, onResetZoom:()=>setGlobalBrushIdx(null) },
            ]}/>
          )}

          {/* ── Livrets (accordions) view ── */}
          {viewMode === "livrets" && livretPoches.map(p => (
            <LivretPocheSection
              key={keyId(p.type_livret, p.nom)}
              poche={p}
              ops={newOps.filter(o => o.poche === p.type_livret && o.nom === p.nom)}
              mois={mois}
              onAdd={(op) => setAddOpTarget({ poche: p, op })}
              onDeleteOp={async id => { await invoke("delete_livret", { id }); onRefresh(); }}
              onDelete={() => setConfirmDelete(p)}
              onEdit={(nom, couleur) => handleEditPoche(p, nom, couleur)}
              onImportParsed={makeImportHandler(p)}
            />
          ))}
        </>
      )}
    </div>
  );
}
