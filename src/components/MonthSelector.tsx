import { useMemo, useRef, useEffect } from "react";

interface Props {
  value: string;         // YYYY-MM currently selected
  onChange: (m: string) => void;
  firstMonth?: string;   // earliest selectable month (YYYY-MM), default = no limit
  range?: number;        // months shown each side of selected (default 6)
}

const MN = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

function addMonths(ym: string, n: number): string {
  let [y, m] = ym.split("-").map(Number);
  m += n;
  while (m > 12) { m -= 12; y++; }
  while (m < 1)  { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default function MonthSelector({ value, onChange, firstMonth, range = 6 }: Props) {
  const todayMonth = new Date().toISOString().slice(0, 7);
  const ref = useRef<HTMLDivElement>(null);

  // Build months centered on `value`, from value-range to value+range
  // Filter out futures (> todayMonth) and pasts (< firstMonth)
  // Never includes todayMonth here — it's always pinned at the right
  const months = useMemo(() => {
    const out: { ym: string; label: string; yearShort: string }[] = [];
    for (let i = -range; i <= range; i++) {
      const ym = addMonths(value, i);
      if (ym > todayMonth) continue;
      if (ym === todayMonth) continue; // pinned separately
      if (firstMonth && ym < firstMonth) continue;
      const [y, m] = ym.split("-").map(Number);
      out.push({ ym, label: MN[m - 1], yearShort: String(y).slice(2) });
    }
    return out;
  }, [value, range, todayMonth, firstMonth]);

  // Scroll selected into view on value change
  useEffect(() => {
    const el = ref.current?.querySelector("[data-sel]") as HTMLElement | null;
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [value]);

  const btnStyle = (ym: string): React.CSSProperties => {
    const isSel = ym === value;
    const isCur = ym === todayMonth;
    return {
      flex: 1,
      minWidth: 0,
      padding: "6px 4px 4px",
      borderRadius: 6,
      border: isSel ? "1px solid var(--gold)" : isCur ? "1px solid var(--border-l)" : "1px solid transparent",
      cursor: "pointer",
      fontFamily: "var(--mono)",
      fontSize: 11,
      lineHeight: 1.2,
      transition: "background .15s, border .15s",
      background: isSel ? "var(--gold)" : isCur ? "var(--bg-3)" : "transparent",
      color: isSel ? "var(--bg-0)" : isCur ? "var(--text-0)" : "var(--text-1)",
      display: "flex",
      flexDirection: "column" as const,
      alignItems: "center",
      gap: 1,
    };
  };

  const todayYm   = todayMonth;
  const [ty, tm]  = todayYm.split("-").map(Number);
  const todayItem = { ym: todayYm, label: MN[tm - 1], yearShort: String(ty).slice(2) };

  return (
    <div style={{
      position: "sticky",
      top: 0,
      zIndex: 20,
      background: "var(--bg-1)",
      border: "1px solid var(--border)",
      borderRadius: "var(--r)",
      padding: "4px 6px",
      width: "100%",
      marginBottom: 24,
      boxSizing: "border-box",
      display: "flex",
      alignItems: "center",
      gap: 4,
      boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
    }}>
      {/* Scrollable strip (never contains todayMonth) */}
      <div ref={ref} style={{ display: "flex", gap: 2, flex: 1, overflowX: "hidden" }}>
        {months.map(m => (
          <button key={m.ym} data-sel={m.ym === value ? true : undefined}
            style={btnStyle(m.ym)} onClick={() => onChange(m.ym)}>
            <span style={{ fontWeight: m.ym === value ? 600 : 400 }}>{m.label}</span>
            <span style={{ fontSize: 9, opacity: 0.7 }}>{m.yearShort}</span>
          </button>
        ))}
      </div>

      {/* Today — always pinned at far right, same button style */}
      <button
        data-sel={todayItem.ym === value ? true : undefined}
        style={{ ...btnStyle(todayItem.ym), flex: "none", minWidth: 38, flexShrink: 0 }}
        onClick={() => onChange(todayItem.ym)}
        title="Mois actuel"
      >
        <span style={{ fontWeight: todayItem.ym === value ? 600 : 400 }}>{todayItem.label}</span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>{todayItem.yearShort}</span>
      </button>
    </div>
  );
}
