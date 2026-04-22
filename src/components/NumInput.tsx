import { useState, useEffect, useRef } from "react";

/**
 * Controlled numeric input that keeps a raw string internally so that
 * intermediate states like "0," / "0." / "-0." never get swallowed.
 * Accepts both "." and "," as decimal separators.
 */
interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "step"> {
  value: number;
  onChange: (v: number) => void;
}

export default function NumInput({ value, onChange, ...rest }: Props) {
  // Convert number to display string: 0 → "", anything else → its string repr
  const numToRaw = (n: number) => (n === 0 ? "" : String(n));

  const [raw, setRaw] = useState(() => numToRaw(value));
  const prevExternal = useRef(value);

  // Sync when value is changed from outside (e.g., date changes resets qty)
  useEffect(() => {
    if (value !== prevExternal.current) {
      prevExternal.current = value;
      // Only overwrite raw if it doesn't already represent the same number
      const cur = parseFloat(raw.replace(",", "."));
      if (cur !== value) setRaw(numToRaw(value));
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const str = e.target.value;
    // Allow comma as decimal separator
    const normalized = str.replace(",", ".");
    setRaw(str);

    const n = parseFloat(normalized);
    if (!isNaN(n)) {
      prevExternal.current = n;
      onChange(n);
    } else if (str === "" || str === "-") {
      prevExternal.current = 0;
      onChange(0);
    }
    // Otherwise it's an intermediate state ("0.", "0,", "-0.") — don't call onChange
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      onChange={handleChange}
      placeholder="0"
      {...rest}
    />
  );
}
