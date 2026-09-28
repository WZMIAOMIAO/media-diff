import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getLanguage, setLanguage, subscribeLanguage, t, type Lang } from './store';

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: typeof t;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getLanguage());

  useEffect(() => subscribeLanguage(setLangState), []);

  const setLang = useCallback((next: Lang) => setLanguage(next), []);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) return { lang: getLanguage(), setLang: setLanguage, t };
  return ctx;
}

export type { Lang };
