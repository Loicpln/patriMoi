// ═══════════════════════════════════════════════════════════════
// PALETTE — couleurs fixes par entité (jamais aléatoires)
// Livrets = tons chauds (or/ambre)
// Investissements = tons froids (bleu/teal/violet)
// ═══════════════════════════════════════════════════════════════

// ── Livrets ────────────────────────────────────────────────────
export const LIVRETS_DEF = [
  { key: "ldds",         label: "LDDS",         taux: 1.50, color: "#F09937" },
  { key: "livret_a",     label: "Livret A",     taux: 1.50, color: "#F0BD40" },
  { key: "lep",          label: "LEP",          taux: 2.50, color: "#EC602A" },
  { key: "livret_jeune", label: "Livret Jeune", taux: 2.40, color: "#DB3B26" },
] as const;

export type LivretKey = typeof LIVRETS_DEF[number]["key"];

export const LIVRET_COLOR: Record<string, string> = Object.fromEntries(
  LIVRETS_DEF.map(l => [l.key, l.color])
);


// ── Vue globale — couleurs des groupes agrégés ─────────────────
// Utilisées dans GlobalRecap (camembert + graphique)
export const GLOBAL_GROUP_COLORS = {
  livrets:         "#DB2338", // Ensemble livrets (ton or)
  investissements: "#1C1E7C", // Ensemble investissements (ton bleu)
} as const;

// ── Sous-catégories d'investissement ──────────────────────────
export const INVEST_SUBCATS = [
  { key: "actions",        label: "Actions",          color: "#EE220C" },
  { key: "etf",            label: "ETF",              color: "#479FF8" },
  { key: "etc",            label: "ETC",              color: "#46BF3D" },
  { key: "private_equity", label: "Private Equity",   color: "#82221F" },
  { key: "fond",           label: "Fond",             color: "#3E40DF" },
  { key: "scp",            label: "SCPI",             color: "#A25300" },
  { key: "digital_cash",   label: "Digital Cash",     color: "#FFF066" },
  { key: "smart_contract", label: "Smart Contract",   color: "#B5FCFF" },
  { key: "stable_coin",    label: "Stable Coin",      color: "#A1443E" },
  { key: "meme_coin",      label: "Meme Coin",        color: "#778D27" },
  { key: "especes",        label: "Espèces",          color: "#78909c" },
] as const;

export type InvestSubcatKey = typeof INVEST_SUBCATS[number]["key"];

// Subcategories eligible for the "Trader" (cost-basis swap) operation
export const TRADEABLE_SUBCATS = ["fond", "digital_cash", "smart_contract", "stable_coin", "meme_coin"] as const;

export const INVEST_SUBCAT_COLOR: Record<string, string> = Object.fromEntries(
  INVEST_SUBCATS.map(s => [s.key, s.color])
);

// ── Catégories de dépenses ─────────────────────────────────────
export const DEPENSE_CATEGORIES: Record<string, { color: string; subs: string[] }> = {
  "Transport":    { color: "#e6a817", subs: ["Assurance auto", "Essence", "Entretien", "Carte grise", "Contrôle technique", "Transport en commun", "Autre"] },
  "Logement":     { color: "#d4793a", subs: ["Loyer", "Assurance habitation", "Charges", "Travaux", "Autre"] },
  "Abonnements":  { color: "#5fa89e", subs: ["Frais Banque Populaire", "Prévoyance civile", "AGPM", "RED SFR", "Amazon", "Apple", "Spotify", "Autre"] },
  "Sport":        { color: "#3a7bd5", subs: ["Judo", "Escalade", "Salle de sport", "Autre"] },
  "Soins":        { color: "#7c6fd4", subs: ["Médecin", "Coiffeur", "Pharmacie", "Optique", "Dentiste", "Autre"] },
  "Autre":        { color: "#78909c", subs: ["Divers"] },
};

export const DEPENSE_CAT_KEYS = Object.keys(DEPENSE_CATEGORIES);

// ── Tooltip style partagé pour Recharts ───────────────────────
export const TOOLTIP_STYLE = {
  background: "rgba(19,22,29,0.5)",
  border: "1px solid #2a2f3f",
  borderRadius: 8,
  fontFamily: "JetBrains Mono",
  fontSize: 11,
  color: "#ebe7de",
};

export const TOOLTIP_ITEM_STYLE = { color: "#ebe7de" };
export const TOOLTIP_LABEL_STYLE = { color: "#9a9691" };

// ── Génère tous les mois entre deux dates ──────────────────────
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

export const todayStr = () => new Date().toISOString().slice(0, 10);
export const curMonthStr = () => new Date().toISOString().slice(0, 7);

// ── Couleur unique par ticker (basée sur hash stable) ─────────────
// Génère une couleur distincte et mémorable pour chaque ticker
const TICKER_COLOR_CACHE: Record<string, string> = {};

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return Math.abs(h);
}

// ── Couleurs fixes pour les types de primes (hues espacées à 30°) ────────────
export const PRIME_TYPE_COLORS: Record<string, string> = {
  "Bourse":                         "hsl(45,  80%, 58%)",
  "Prime d'activité":               "hsl(165, 70%, 52%)",
  "Prime de Noël":                  "hsl(0,   72%, 60%)",
  "Prime vacances":                 "hsl(30,  80%, 60%)",
  "Aides activités sportives":      "hsl(120, 60%, 55%)",
  "Remboursement impôts":           "hsl(330, 68%, 62%)",
  "Prime de parainnage":            "hsl(195, 72%, 58%)",
  "Cours particuliers":             "hsl(75,  68%, 54%)",
  "Autre aide":                     "hsl(240, 50%, 65%)",
};

// Palette de couleurs distinctes (HSL avec saturation/luminosité fixes)
export function tickerColor(ticker: string): string {
  if (TICKER_COLOR_CACHE[ticker]) return TICKER_COLOR_CACHE[ticker];
  const h = hashStr(ticker) % 360;
  // Évite les tons trop proches du fond sombre (teintes très sombres)
  const l = 48 + (hashStr(ticker + "_l") % 18); // 48–66% luminosité
  const s = 60 + (hashStr(ticker + "_s") % 25); // 60–85% saturation
  const color = `hsl(${h}, ${s}%, ${l}%)`;
  TICKER_COLOR_CACHE[ticker] = color;
  return color;
}

// ── Sous-couleur (plus foncée) pour l'anneau externe ─────────────
export function tickerColorDim(ticker: string): string {
  const c = tickerColor(ticker);
  return c.replace("hsl(", "hsla(").replace(")", ", 0.7)");
}

// ── Sous-catégorie de dépense → couleur unique ────────────────────
const DEPENSE_SUB_COLOR_CACHE: Record<string, string> = {};
export function depenseSubColor(cat: string, sub: string): string {
  const key = `${cat}__${sub}`;
  if (DEPENSE_SUB_COLOR_CACHE[key]) return DEPENSE_SUB_COLOR_CACHE[key];
  const base = DEPENSE_CATEGORIES[cat]?.color ?? "#888";
  // Derive from base hue, vary lightness by sub index
  const h = hashStr(key) % 360;
  const baseHsl = base; // use hash for slight variation
  const l = 40 + (hashStr(sub) % 25);
  const s = 55 + (hashStr(key + "s") % 20);
  const color = `hsl(${h}, ${s}%, ${l}%)`;
  DEPENSE_SUB_COLOR_CACHE[key] = color;
  return color;
}

// ── Date par défaut selon le mois sélectionné ─────────────────────────────────
// Si mois sélectionné = mois actuel → date du jour
// Sinon → premier jour du mois sélectionné
export function defaultDateForMonth(selectedMonth: string): string {
  const curMonth = new Date().toISOString().slice(0, 7);
  if (selectedMonth >= curMonth) return new Date().toISOString().slice(0, 10);
  return `${selectedMonth}-01`;
}
