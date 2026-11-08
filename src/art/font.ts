// 3×5 pixel font (glyph table adapted from Habblaud's client/src/art/pixelfont.ts, MIT) drawing on PixelBuf.
// Lowercase only; 4 px per character (3 + 1 space). A 32 px key fits 7 characters per line with 2 px padding.
import type { PixelBuf } from '../habblaud';

const G: Record<string, string> = {
  a: '010101111101101', b: '110101110101110', c: '011100100100011', d: '110101101101110', e: '111100110100111',
  f: '111100110100100', g: '011100101101011', h: '101101111101101', i: '111010010010111', j: '001001001101010',
  k: '101101110101101', l: '100100100100111', m: '101111111101101', n: '110101101101101', o: '010101101101010',
  p: '110101110100100', q: '010101101110011', r: '110101110101101', s: '011100010001110', t: '111010010010010',
  u: '101101101101111', v: '101101101101010', w: '101101111111101', x: '101101010101101', y: '101101010010010',
  z: '111001010100111', '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010', '8': '111101111101111',
  '9': '111101111001110', _: '000000000000111', '-': '000000111000000', '#': '101111101111101', '.': '000000000000010',
  '(': '010100100100010', ')': '010001001001010', '/': '001001010100100', ' ': '000000000000000', ':': '000010000010000',
  ',': '000000000010100', '>': '100010001010100', '<': '001010100010001', '+': '000010111010000',
  '%': '101001010100101', '!': '010010010000010', '?': '110001010000010', '"': '101101000000000', "'": '010010000000000',
  '=': '000111000111000', '*': '000101010101000', '|': '010010010010010', '[': '110100100100110', ']': '011001001001011',
  '{': '011010110010011', '}': '110010011010110', $: '011110010011110', '&': '010101010101011', '~': '000011110000000',
  '@': '010101111100011', ';': '000010000010100', '^': '010101000000000', '`': '100010000000000', '\\': '100100010001001',
};
const ACCENT: Record<string, string> = { '·': '-', '—': '-', '–': '-', '…': '.', '“': '"', '”': '"', '‘': "'", '’': "'", è: 'e', ì: 'i', ò: 'o', ù: 'u', ü: 'u', ñ: 'n', á: 'a', à: 'a', â: 'a', ã: 'a', é: 'e', ê: 'e', í: 'i', ó: 'o', ô: 'o', õ: 'o', ú: 'u', ç: 'c' };

export const CHAR_W = 4;
export const LINE_H = 7;

export function normalizeText(s: string): string {
  return [...s.toLowerCase()].map((ch) => ACCENT[ch] ?? (G[ch] ? ch : ch === '\t' ? ' ' : '?')).join('');
}

export function textWidth(s: string): number {
  return Math.max(0, [...s].length * CHAR_W - 1);
}

/** Draws `text` at (x, y); `shadow` adds a 1 px drop shadow for legibility over art. */
export function text(b: PixelBuf, s: string, x: number, y: number, color: string, shadow?: string): void {
  let cx = x;
  for (const ch of normalizeText(s)) {
    const g = G[ch] ?? G['?'];
    for (let i = 0; i < 15; i++) {
      if (g[i] !== '1') continue;
      const px = cx + (i % 3);
      const py = y + Math.floor(i / 3);
      if (shadow) b.set(px + 1, py + 1, shadow);
      b.set(px, py, color);
    }
    cx += CHAR_W;
  }
}

export function textCentered(b: PixelBuf, s: string, cx: number, y: number, color: string, shadow?: string): void {
  text(b, s, Math.round(cx - textWidth(normalizeText(s)) / 2), y, color, shadow);
}

const CUT_AFTER = '-_/:'; // "feat/" + "deck"
const CUT_BEFORE = '.-_'; // "panels" + ".ts", "habblaud" + "-deck"

/** Where to cut a word that is longer than `cols`: at a separator if there is one, else hard. */
function cutAt(w: string, cols: number): { head: string; rest: string } {
  for (let p = cols; p >= 3; p--) {
    if (CUT_AFTER.includes(w[p - 1]) || CUT_BEFORE.includes(w[p])) return { head: w.slice(0, p), rest: w.slice(p) };
  }
  return { head: w.slice(0, cols - 1) + '-', rest: w.slice(cols - 1) };
}

/** Word-wraps into lines of at most `cols` characters (long words break at separators, else hard-cut). */
export function wrap(s: string, cols: number, maxLines = 99): string[] {
  const words = normalizeText(s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (let w of words) {
    while (w.length > cols) {
      if (cur) { lines.push(cur); cur = ''; }
      const { head, rest } = cutAt(w, cols);
      lines.push(head);
      w = rest;
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= cols) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const out = lines.slice(0, maxLines);
    out[maxLines - 1] = out[maxLines - 1].slice(0, cols - 1) + '~';
    return out;
  }
  return lines;
}
