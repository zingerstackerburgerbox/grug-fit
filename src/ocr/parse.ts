/**
 * Nutrition-panel text parser (pure, no DOM) for AU/NZ "Nutrition Information" tables
 * (Avg Quantity per Serving | per 100 g/mL) and US "Nutrition Facts" labels.
 */
import type { Nutrients } from '../types';

export type OcrLine = { text: string; conf: number }; // conf 0..100
export type Field = keyof Nutrients;
export type Parsed = {
  style: 'AU' | 'US' | 'unknown';
  servingSize?: number; servingUnit?: 'g' | 'ml'; servingsPerPack?: number;
  per100: Partial<Nutrients>; perServing: Partial<Nutrients>;
  /** 0..1 confidence per field (of per-100 value) */
  conf: Partial<Record<Field | 'servingSize' | 'servingsPerPack', number>>;
  warnings: string[]; flagged: (Field | 'servingSize')[];
  columns: ('serving' | '100' | 'dv')[];
};

type Def = { key: Field; re: RegExp; unit: 'kcal' | 'g' | 'mg' | 'ug' };
// order matters: more specific first
const DEFS: Def[] = [
  { key: 'satfat', re: /\bsat(urated|\.)?\b(?! *fatty acids? *-)|\bsaturates\b/, unit: 'g' },
  { key: 'sugar', re: /\b(sugars?|total sugars)\b/, unit: 'g' },
  { key: 'fibre', re: /\b(dietary )?fib(re|er)\b/, unit: 'g' },
  { key: 'protein', re: /\bprotein\b/, unit: 'g' },
  { key: 'carbs', re: /\bcarbo?hydrates?\b|\btotal carb|\bcarbs?\b/, unit: 'g' },
  { key: 'fat', re: /\b(fat,? total|total fat|fat)\b/, unit: 'g' },
  { key: 'sodium', re: /\bsodium\b/, unit: 'mg' },
  { key: 'potassium', re: /\bpotassium\b/, unit: 'mg' },
  { key: 'calcium', re: /\bcalcium\b/, unit: 'mg' },
  { key: 'iron', re: /\biron\b/, unit: 'mg' },
  { key: 'magnesium', re: /\bmagnesium\b/, unit: 'mg' },
  { key: 'vitC', re: /\bvitamin c\b|\bascorbic/, unit: 'mg' },
  { key: 'vitA', re: /\bvitamin a\b/, unit: 'ug' },
  { key: 'vitD', re: /\bvitamin d\d?\b/, unit: 'ug' },
  { key: 'b12', re: /\b(vitamin )?b ?12\b|cobalamin/, unit: 'ug' },
  { key: 'folate', re: /\bfol(ate|ic acid)\b/, unit: 'ug' }
];
const SKIP = /\b(trans|polyunsaturated|monounsaturated|mono|poly|added sugars?|includes|cholesterol|lactose|starch|sugar alcohols?|omega)\b/;

/** Fix common OCR confusions inside numeric tokens and normalise decimal commas. */
export function fixOcr(raw: string): string {
  let s = raw.replace(/[|]/g, ' ').replace(/[“”"'`]/g, '').replace(/\u00b5|μ/g, 'u');
  // letters that are really digits when touching digits/decimal points
  for (let i = 0; i < 2; i++) {
    s = s.replace(/(?<=[\d.,])[oO](?=[\d.,]|\s*(?:k?j|kcal|m?c?g|ug|ml|g\b))/gi, '0').replace(/(?<=\s|^)[oO](?=[.,]\d)/g, '0')
      .replace(/(?<=\d)[lI](?=[\d.,])/g, '1').replace(/(?<=[\s(]|^)[lI](?=\d)/g, '1').replace(/(?<=\d)[lI](?=\s*(?:g|mg|kj)\b)/g, '1')
      .replace(/(?<=\d)[sS](?=\d)/g, '5').replace(/(?<=\d)B(?=\d)/g, '8');
  }
  s = s.replace(/(\d)\s*[,](\d{3})(?=\s*k?j)/gi, '$1$2'); // 1,560kJ thousands separator
  s = s.replace(/(\d),(\d)/g, '$1.$2'); // decimal comma
  s = s.replace(/(\d)\s+\.\s*(\d)/g, '$1.$2').replace(/(\d)\.\s+(\d)/g, '$1.$2');
  s = s.replace(/\((\d{1,4}(?:\.\d)?)9\)/g, '($1g)') // "(559)" = "(55g)"
    .replace(/(per\s*100)\s*9\b/gi, '$1g').replace(/(\d)\s*m[a9q]\b/gi, '$1mg'); // "per 1009", "240ma"
  s = s.replace(/(\d)\s*(mcg|ug)\b/gi, '$1ug').replace(/(\d)\s*(mg|kj|kcal|g|ml)\b/gi, '$1$2');
  return s;
}

type Num = { v: number; unit: string; pct: boolean; lt: boolean; raw: string };
const NUM_RE = /(<\s*)?(\d+(?:\.\d+)?)\s*(kj|kcal|cal|mg|ug|mcg|g|ml|%)?/gi;
function numbers(s: string): Num[] {
  const out: Num[] = []; let m: RegExpExecArray | null; NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(s))) { const unit = (m[3] || '').toLowerCase(); out.push({ v: parseFloat(m[2]), unit: unit === 'mcg' ? 'ug' : unit, pct: unit === '%', lt: !!m[1], raw: m[2] }); }
  return out;
}
const toUnit = (n: Num, want: Def['unit']) => {
  const u = n.unit;
  if (want === 'g') return u === 'mg' ? n.v / 1000 : u === 'ug' ? n.v / 1e6 : n.v;
  if (want === 'mg') return u === 'g' ? n.v * 1000 : u === 'ug' ? n.v / 1000 : n.v;
  if (want === 'ug') return u === 'mg' ? n.v * 1000 : u === 'g' ? n.v * 1e6 : n.v;
  return n.v;
};
const r = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

export function parseLabel(lines0: OcrLine[]): Parsed {
  const res: Parsed = { style: 'unknown', per100: {}, perServing: {}, conf: {}, warnings: [], flagged: [], columns: [] };
  const lines = lines0.map((l) => ({ text: fixOcr(l.text), low: fixOcr(l.text).toLowerCase(), conf: l.conf })).filter((l) => l.text.trim());
  const all = lines.map((l) => l.low).join('\n');
  const us = /nutrition facts|daily value|calories|total carbohydrate|amount per serving/.test(all);
  const au = /nutrition information|per 100 ?(g|ml)|quantity per|avg\.? quantity|average quantity|servings? per (package|pack)/.test(all);
  res.style = au && !/nutrition facts/.test(all) ? 'AU' : us ? 'US' : au ? 'AU' : 'unknown';

  // serving size / servings per pack
  for (const l of lines) {
    const ss = /serving size[^\d]*?(\d+(?:\.\d+)?)\s*(g|ml)\b/.exec(l.low) || /serving size.*?\((\d+(?:\.\d+)?)\s*(g|ml)\)/.exec(l.low);
    if (ss && res.servingSize == null) { res.servingSize = parseFloat(ss[1]); res.servingUnit = ss[2] as any; res.conf.servingSize = l.conf / 100; }
    const sp = /servings? per (package|pack|container|pkt)[^\d]*(\d+(?:\.\d+)?)/.exec(l.low) || /(\d+(?:\.\d+)?)\s*servings? per (package|pack|container)/.exec(l.low) || /about (\d+(?:\.\d+)?) servings/.exec(l.low);
    if (sp && res.servingsPerPack == null) { res.servingsPerPack = parseFloat(sp[2] && /\d/.test(sp[2]) ? sp[2] : sp[1]); res.conf.servingsPerPack = l.conf / 100; }
  }
  if (res.servingSize == null) { // AU header form: "Avg Quantity per Serving (30g)" / "per serve 30 g"
    for (const l of lines) { const m = /per serv(?:ing|e)[^\d\n]{0,6}\(?(\d+(?:\.\d+)?)\s*(g|ml)/.exec(l.low); if (m) { res.servingSize = parseFloat(m[1]); res.servingUnit = m[2] as any; res.conf.servingSize = l.conf / 100 * 0.9; break; } }
  }

  // column order for AU tables, from the header line
  if (res.style !== 'US') {
    const hdr = lines.find((l) => /per serv/.test(l.low) && /100/.test(l.low)) || lines.find((l) => /per 100/.test(l.low));
    if (hdr) { const i = hdr.low.search(/per serv|quantity per serv|avg.*serv/), j = hdr.low.search(/100\s*(g|ml)|per 100/); res.columns = i >= 0 && j >= 0 ? (i < j ? ['serving', '100'] : ['100', 'serving']) : j >= 0 ? ['100'] : ['serving', '100']; }
    else res.columns = ['serving', '100'];
  } else res.columns = ['serving'];

  // merge label-only lines with a following numbers-only line (misaligned columns)
  const merged: typeof lines = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; const hasNum = /\d/.test(l.low); const next = lines[i + 1];
    if (!hasNum && next && /^[\s<\d.]/.test(next.low) && !/[a-z]{4,}/.test(next.low.replace(/kj|kcal|mg|ug|ml/g, ''))) { merged.push({ text: l.text + ' ' + next.text, low: l.low + ' ' + next.low, conf: Math.min(l.conf, next.conf) * 0.95 }); i++; }
    else merged.push(l);
  }

  const setVal = (key: Field, which: 'serving' | '100', v: number, c: number) => {
    const tgt = which === '100' ? res.per100 : res.perServing;
    if (tgt[key] == null) { (tgt as any)[key] = v; if (which === '100' || res.conf[key] == null) res.conf[key] = Math.min(res.conf[key] ?? 1, c); }
  };
  let energyKcalSeen = false;
  for (const l of merged) {
    const label = l.low.split(/\d/)[0] || '';
    let c = l.conf / 100;
    const nums = numbers(l.low.slice(label.length)).filter((n) => !n.pct);
    if (!nums.length) continue;
    // ENERGY
    if (/energy|calories|\bcal\b|kilojoules?/.test(label) && !/from fat/.test(label)) {
      const kcalVals = nums.filter((n) => n.unit === 'kcal' || n.unit === 'cal' || (/calories/.test(label) && !n.unit));
      const kjVals = nums.filter((n) => n.unit === 'kj' || (!n.unit && /kj|kilojoule/.test(label)));
      const pick = kcalVals.length ? kcalVals.map((n) => n.v) : kjVals.length ? kjVals.map((n) => n.v / 4.184) : nums.filter((n) => !n.unit).map((n) => n.v / ((res.style === 'US') ? 1 : 4.184));
      if (kcalVals.length) energyKcalSeen = true; else if (energyKcalSeen) continue;
      assign('kcal', pick.map((v) => r(v, 0)), c * (kcalVals.length || kjVals.length ? 1 : 0.7));
      continue;
    }
    if (SKIP.test(label)) continue;
    const def = DEFS.find((d) => d.re.test(label));
    if (!def) continue;
    let cc = c;
    const vals = nums.filter((n) => n.unit !== 'kj' && n.unit !== 'kcal').map((n) => {
      let v = toUnit(n, def.unit); if (!n.unit && def.unit !== 'g') v = n.v;
      // a "g" unit misread as "9": "3.19" → 3.1 g, "379" → 37 g (grams values > 100 are impossible per 100 g / typical serve)
      if (def.unit === 'g' && !n.unit && (/^\d+\.\d9$/.test(n.raw) || (/^\d{2,}9$/.test(n.raw) && n.v > Math.max(100, res.servingSize || 0)))) { v = parseFloat(n.raw.slice(0, -1)); cc = Math.min(cc, 0.8); }
      return n.lt ? 0 : v;
    });
    c = cc;
    assign(def.key, vals.map((v) => r(v, def.unit === 'g' ? 1 : def.unit === 'mg' ? 0 : 1)), c);
  }
  function assign(key: Field, vals: number[], c: number) {
    if (!vals.length) return;
    if (res.style === 'US') { setVal(key, 'serving', vals[0], c); return; }
    const cols = res.columns.length ? res.columns : ['serving', '100'];
    if (vals.length >= 2 && cols.length >= 2) { setVal(key, cols[0] as any, vals[0], c); setVal(key, cols[1] as any, vals[1], c); }
    else if (cols.length === 1) setVal(key, cols[0] as any, vals[0], c);
    else { setVal(key, '100', vals[vals.length - 1], c * 0.6); } // one value in a 2-column table: ambiguous
  }

  // derive per-100 from per-serving where needed
  const ss = res.servingSize;
  if (ss && ss > 0) {
    for (const k of Object.keys(res.perServing) as Field[]) {
      const ps = res.perServing[k]!; const derived = (ps * 100) / ss;
      if (res.per100[k] == null) { res.per100[k] = r(derived, k === 'kcal' || k === 'sodium' ? 0 : 1); res.conf[k] = Math.min(res.conf[k] ?? 1, res.style === 'US' ? 0.95 : 0.7); }
      else { // cross-check the two columns
        const p100 = res.per100[k]!; const tol = Math.max(0.6, p100 * 0.12);
        const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.6, b * 0.12);
        if (Math.abs(derived - p100) > tol && near(derived, p100 / 10)) { res.per100[k] = r(p100 / 10, 1); res.conf[k] = Math.min(res.conf[k] ?? 1, 0.6); res.warnings.push(`${k}: read ${p100} per 100 but the per-serving value suggests ${r(p100 / 10, 1)} — assumed a missed decimal point`); }
        else if (Math.abs(derived - p100) > tol && near(derived / 10, p100)) { res.perServing[k] = r(ps / 10, 1); res.conf[k] = Math.min(res.conf[k] ?? 1, 0.7); }
        else if (Math.abs(derived - p100) > tol && p100 + ps > 0.5) { res.flagged.push(k); res.conf[k] = Math.min(res.conf[k] ?? 1, 0.5); res.warnings.push(`${k}: per-serving (${ps}) and per-100 (${p100}) columns disagree for a ${ss} ${res.servingUnit || 'g'} serving`); }
      }
    }
  } else if (Object.keys(res.perServing).length && !Object.keys(res.per100).length) res.warnings.push('No serving size found — enter it so per-100 g values can be calculated.');

  // sanity checks on per-100
  const p = res.per100;
  if (p.kcal != null && p.protein != null && p.fat != null && p.carbs != null) {
    const avail = res.style === 'US' ? Math.max(0, p.carbs - (p.fibre || 0)) : p.carbs;
    const calc = 4 * p.protein + 4 * avail + 9 * p.fat + 2 * (p.fibre || 0);
    if (Math.abs(calc - p.kcal) > Math.max(25, p.kcal * 0.15)) { res.warnings.push(`Energy check: label says ${r(p.kcal, 0)} kcal/100, but macros add up to ≈${r(calc, 0)} kcal. One of energy/protein/fat/carbs is probably misread.`); res.flagged.push('kcal'); res.conf.kcal = Math.min(res.conf.kcal ?? 1, 0.55); }
  }
  if (p.sugar != null && p.carbs != null && p.sugar > p.carbs + 0.5) { res.warnings.push('Sugars are higher than carbohydrate — check both.'); res.flagged.push('sugar'); }
  if (p.satfat != null && p.fat != null && p.satfat > p.fat + 0.2) { res.warnings.push('Saturated fat is higher than total fat — check both.'); res.flagged.push('satfat'); }
  const gsum = (p.protein || 0) + (p.fat || 0) + (p.carbs || 0) + (res.style === 'AU' ? p.fibre || 0 : 0);
  if (gsum > 102 && res.servingUnit !== 'ml') res.warnings.push(`Macros add up to ${r(gsum)} g per 100 g (impossible) — check the column values.`);
  if (p.sodium != null && p.sodium > 40000) { res.warnings.push('Sodium looks too high — is it in g or mg?'); res.flagged.push('sodium'); }
  if (!res.servingSize && res.style !== 'unknown') res.flagged.push('servingSize');
  for (const k of ['kcal', 'protein', 'fat', 'carbs'] as Field[]) if (p[k] == null) res.warnings.push(`Couldn't read ${k === 'kcal' ? 'energy' : k} — please enter it.`);
  return res;
}

/** Convert parsed label into app storage: per-100 with carbs as TOTAL (incl. fibre) so net = total − fibre. */
export function toPer100(pz: Parsed): Partial<Nutrients> {
  const o: Partial<Nutrients> = { ...pz.per100 };
  if (pz.style !== 'US' && o.carbs != null) o.carbs = r(o.carbs + (o.fibre || 0)); // AU/NZ "carbohydrate" = available carbs
  return o;
}
