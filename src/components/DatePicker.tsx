import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

interface Props {
  value: string;              // YYYY-MM-DD
  onChange: (v: string) => void;
  min?: string;               // YYYY-MM-DD
  max?: string;               // YYYY-MM-DD
  placeholder?: string;
}

const FR_MONTHS = [
  "Janvier","Février","Mars","Avril","Mai","Juin",
  "Juillet","Août","Septembre","Octobre","Novembre","Décembre",
];
const FR_DAYS = ["Lu","Ma","Me","Je","Ve","Sa","Di"];

function parseDate(s: string): { y: number; m: number; d: number } | null {
  if (!s || s.length < 10) return null;
  const parts = s.split("-").map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function toStr(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** Returns 0=Monday … 6=Sunday for the 1st of the given month. */
function firstDayOfWeek(y: number, m: number): number {
  const jsDay = new Date(y, m - 1, 1).getDay(); // 0=Sun
  return (jsDay + 6) % 7;                        // Monday-first
}

export default function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "jj/mm/aaaa",
}: Props) {
  const parsed    = parseDate(value);
  const today     = new Date();
  const todayStr  = toStr(today.getFullYear(), today.getMonth() + 1, today.getDate());

  const [open, setOpen]   = useState(false);
  const [viewY, setViewY] = useState(parsed?.y ?? today.getFullYear());
  const [viewM, setViewM] = useState(parsed?.m ?? (today.getMonth() + 1));
  const [hov,   setHov]   = useState<number | null>(null);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef   = useRef<HTMLDivElement>(null);

  // Position the popup relative to the trigger using fixed coords (avoids overflow clipping)
  const computePos = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const popupH = 280; // estimated calendar height
    const below   = r.bottom + 4 + popupH < window.innerHeight;
    setPopupStyle({
      position: "fixed",
      top: below ? r.bottom + 4 : r.top - popupH - 4,
      left: r.left,
      width: Math.max(r.width, 240),
    });
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    computePos();
    const handler = (e: MouseEvent) => {
      const t = triggerRef.current;
      const p = popupRef.current;
      if (t && t.contains(e.target as Node)) return;
      if (p && p.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, computePos]);

  // Sync view month when value changes externally
  useEffect(() => {
    const p = parseDate(value);
    if (p) { setViewY(p.y); setViewM(p.m); }
  }, [value]);

  const prevMonth = () => {
    if (viewM === 1) { setViewM(12); setViewY(y => y - 1); }
    else              setViewM(m => m - 1);
  };
  const nextMonth = () => {
    if (viewM === 12) { setViewM(1); setViewY(y => y + 1); }
    else               setViewM(m => m + 1);
  };
  const prevYear = () => setViewY(y => y - 1);
  const nextYear = () => setViewY(y => y + 1);

  const selectDay = (d: number) => {
    onChange(toStr(viewY, viewM, d));
    setOpen(false);
  };

  const formatDisplay = () => {
    if (!parsed) return placeholder;
    return `${String(parsed.d).padStart(2,"0")}/${String(parsed.m).padStart(2,"0")}/${parsed.y}`;
  };

  // Build cell array: nulls for empty slots, then day numbers
  const first = firstDayOfWeek(viewY, viewM);
  const days  = daysInMonth(viewY, viewM);
  const cells: (number | null)[] = [
    ...Array(first).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const popup = open ? createPortal(
    <div ref={popupRef} className="dp-popup" style={popupStyle}>
      {/* Month / year navigation */}
      <div className="dp-nav">
        <button className="dp-nav-btn" onClick={prevYear}  title="Année précédente">«</button>
        <button className="dp-nav-btn" onClick={prevMonth} title="Mois précédent">‹</button>
        <span className="dp-nav-title">
          {FR_MONTHS[viewM - 1]} {viewY}
        </span>
        <button className="dp-nav-btn" onClick={nextMonth} title="Mois suivant">›</button>
        <button className="dp-nav-btn" onClick={nextYear}  title="Année suivante">»</button>
      </div>

      {/* Weekday headers */}
      <div className="dp-weekdays">
        {FR_DAYS.map(d => <div key={d} className="dp-wd">{d}</div>)}
      </div>

      {/* Day cells */}
      <div className="dp-days">
        {cells.map((d, i) => {
          if (d === null) return <div key={`x-${i}`} />;
          const s        = toStr(viewY, viewM, d);
          const isSel    = s === value;
          const isToday  = s === todayStr;
          const disabled = (!!min && s < min) || (!!max && s > max);
          const isHov    = hov === d && !disabled && !isSel;
          return (
            <button
              key={d}
              className={[
                "dp-day",
                isSel    ? "dp-day--sel"   : "",
                isToday  ? "dp-day--today" : "",
                disabled ? "dp-day--dis"   : "",
                isHov    ? "dp-day--hov"   : "",
              ].filter(Boolean).join(" ")}
              onClick={() => !disabled && selectDay(d)}
              onMouseEnter={() => setHov(d)}
              onMouseLeave={() => setHov(null)}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="dp-trigger"
        data-open={open || undefined}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ color: parsed ? "var(--text-0)" : "var(--text-2)" }}>
          {formatDisplay()}
        </span>
        <span className="dp-caret">▾</span>
      </button>
      {popup}
    </>
  );
}
