import { dictionaries, type Lang } from './translations';

const STORAGE_KEY = 'media-diff:lang';
const DEFAULT_LANG: Lang = 'zh';

function isLang(value: unknown): value is Lang {
  return value === 'zh' || value === 'en';
}

function loadLang(): Lang {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLang(value) ? value : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

let currentLang: Lang = loadLang();
const listeners = new Set<(lang: Lang) => void>();

export function getLanguage(): Lang {
  return currentLang;
}

export function setLanguage(lang: Lang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // ignore quota / private-mode errors
  }
  listeners.forEach((fn) => fn(lang));
}

export function subscribeLanguage(fn: (lang: Lang) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Translate a key for the current language. Usable both inside React
 * components (through `useI18n`) and in plain modules (e.g. api helpers).
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = dictionaries[currentLang] ?? dictionaries.zh;
  let text = dict[key] ?? dictionaries.zh[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    }
  }
  return text;
}

export type { Lang };
