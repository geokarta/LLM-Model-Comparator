import { createContext, useContext, useEffect, useState } from 'react';
import { Lang, TRANSLATIONS, TranslationKey } from './translations.ts';

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'fr',
  setLang: () => {},
  t: (k) => TRANSLATIONS.fr[k],
});

function detectInitialLang(): Lang {
  if (typeof window === 'undefined') return 'fr';
  const saved = window.localStorage.getItem('ai_model_insight_lang');
  if (saved === 'fr' || saved === 'en' || saved === 'es') return saved;
  const nav = (navigator.language || 'fr').toLowerCase();
  if (nav.startsWith('es')) return 'es';
  if (nav.startsWith('en')) return 'en';
  return 'fr';
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);

  const setLang = (next: Lang) => {
    setLangState(next);
    window.localStorage.setItem('ai_model_insight_lang', next);
    document.documentElement.lang = next;
  };

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = (key: TranslationKey): string => TRANSLATIONS[lang][key] ?? TRANSLATIONS.fr[key];

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
