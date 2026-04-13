import { useMemo } from "react";

// ── Sélecteur d'année horizontal (style MonthSelector) ────────────────────
export default function YearSelector({ value, onChange, years }: { value: number; onChange: (y: number) => void; years: number[] }) {
  const curYear = new Date().getFullYear();

  // Visible = ±3 autour de la valeur sélectionnée, parmi les années avec données
  // L'année en cours est toujours épinglée à droite (exclue du strip)
  const visible = useMemo(() => {
    const set = new Set(years);
    const out: number[] = [];
    for (let y = value - 3; y <= value + 3; y++) {
      if (y === curYear) continue; // épinglée séparément
      if (set.has(y) || y === value) out.push(y);
    }
    return out;
  }, [value, years, curYear]);

  const btnStyle = (y: number): React.CSSProperties => {
    const isSel = y === value;
    const isCur = y === curYear;
    return {
      flex: 1, minWidth: 0, padding: "9.5px 8px",
      borderRadius: 6,
      border: isSel ? "1px solid var(--gold)" : isCur ? "1px solid var(--border-l)" : "1px solid transparent",
      cursor: "pointer", fontFamily: "var(--mono)", fontSize: 12, lineHeight: 1.3,
      background: isSel ? "var(--gold)" : isCur ? "var(--bg-3)" : "transparent",
      color: isSel ? "var(--bg-0)" : isCur ? "var(--text-0)" : "var(--text-1)",
      fontWeight: isSel ? 600 : 400,
    };
  };

  return (
    <div style={{
      position: "sticky",
      top: 0,
      zIndex: 20,
      background: "var(--bg-1)",
      border: "2px solid var(--gold)",
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
      {/* Strip scrollable sans l'année en cours */}
      <div style={{ display: "flex", gap: 2, flex: 1 }}>
        {visible.map(y => (
          <button key={y} style={btnStyle(y)} onClick={() => onChange(y)}>{y}</button>
        ))}
      </div>
      {/* Année en cours — toujours épinglée à droite */}
      <button style={{ ...btnStyle(curYear), flex: "none", flexShrink: 0 }} onClick={() => onChange(curYear)}>
        {curYear}
      </button>
    </div>
  );
}