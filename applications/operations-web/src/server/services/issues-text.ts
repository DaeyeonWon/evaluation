/**
 * Issue Report — text helpers for new-pattern detection (server-only, pure).
 *
 * Tokenization is deliberately simple and language-aware enough for the four evaluation languages:
 *  - lowercase, strip punctuation (incl. ¿¡？。！、)
 *  - ko / en / es: whitespace tokens
 *  - ja: script runs (Katakana, Kanji, Hiragana, Latin) — Japanese has no spaces
 * Unigrams + adjacent bigrams are the "terms". Digits-only tokens and 1-character tokens are dropped.
 *
 * Pattern kinds (first match wins):
 *  new_feature_name  — contains a product/feature lexicon term (PRODUCT_TERMS) or the expected intent is galaxy_ai.*
 *  code_switch       — ko/ja text with a Latin word, or es text with an English lexicon word (EN_IN_ES)
 *  new_term          — has at least one term never seen in the baseline window
 *  new_phrasing      — only the phrasing (template) is new; every term was seen before
 */
import type { LangCode, PatternKind } from "@/lib/types";

/** Product / feature names (a real deployment loads this lexicon from the product catalog). */
export const PRODUCT_TERMS = [
  "now brief",
  "now nudge",
  "audio eraser",
  "creative studio",
  "gemini",
  "나우 브리프",
  "나우 넛지",
  "오디오 지우개",
  "크리에이티브 스튜디오",
  "제미나이",
  "spotify",
];

/** English words that signal es-MX ↔ English code-switching inside a Spanish utterance. */
export const EN_IN_ES = new Set(["timer", "wifi", "playlist", "text", "lights", "ok", "play", "off", "on", "snooze", "brightness", "spotify"]);

const PUNCT = /[?!.,¿¡？。！、"“”'’()[\]{}:;~…]/g;

/** function words that never make a "new term" */
const STOP: Record<LangCode, Set<string>> = {
  ko: new Set(["좀", "나", "지금", "이거", "그"]),
  en: new Set(["the", "a", "an", "to", "my", "me", "of", "on", "in", "is", "it", "this", "about", "for", "and", "i"]),
  ja: new Set(["して", "って", "です"]),
  es: new Set(["un", "una", "de", "el", "la", "las", "los", "que", "en", "por", "me", "mi", "lo", "al", "del", "y"]),
};

export function tokens(text: string, lang: LangCode): string[] {
  const s = text.toLowerCase().replace(PUNCT, " ");
  const keep = (t: string) => t.length > 1 && !/^\d+$/.test(t) && !STOP[lang].has(t);
  if (lang === "ja") {
    const runs = s.match(/[゠-ヿー]+|[一-鿿]+|[぀-ゟ]+|[a-z0-9\-]+/g) ?? [];
    return runs.filter(keep);
  }
  return s.split(/\s+/).filter(keep);
}

/** unigrams + bigrams */
export function terms(text: string, lang: LangCode): string[] {
  const tk = tokens(text, lang);
  const out = new Set(tk);
  for (let i = 0; i + 1 < tk.length; i++) out.add(tk[i] + " " + tk[i + 1]);
  return [...out];
}

export function hasProductTerm(text: string): string | null {
  const s = text.toLowerCase();
  for (const p of PRODUCT_TERMS) if (s.includes(p)) return p;
  return null;
}

export function isCodeSwitch(text: string, lang: LangCode): string | null {
  if (lang === "ko" || lang === "ja") {
    const m = text.match(/[A-Za-z][A-Za-z\-]+/g);
    if (m) {
      const w = m.find((x) => !hasProductTerm(x) && !/^(wi-fi|tv|pt|ai)$/i.test(x));
      if (w) return w.toLowerCase();
    }
    return null;
  }
  if (lang === "es") {
    for (const t of tokens(text, lang)) if (EN_IN_ES.has(t)) return t;
  }
  return null;
}

export function patternKind(text: string, lang: LangCode, intent: string, novelTerms: string[]): PatternKind {
  if (hasProductTerm(text) || intent.startsWith("galaxy_ai.")) return "new_feature_name";
  if (isCodeSwitch(text, lang)) return "code_switch";
  if (novelTerms.length) return "new_term";
  return "new_phrasing";
}

/** FNV-1a 32-bit → base36 (stable ids). */
export function hash36(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).padStart(7, "0");
}
