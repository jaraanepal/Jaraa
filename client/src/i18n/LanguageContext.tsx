import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import en from "./en.json";
import ne from "./ne.json";

export type Lang = "ne" | "en";

const DICTS: Record<Lang, unknown> = { ne, en };

function resolve(dict: unknown, key: string): string | undefined {
  const parts = key.split(".");
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === "string" ? cur : undefined;
}

/** Translate a dotted key, with {var} interpolation. Falls back en -> key. */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = resolve(DICTS[lang], key) ?? resolve(DICTS.en, key) ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<LangCtx>({ lang: "ne", setLang: () => {}, t: (k) => k });

const STORAGE_KEY = "jaraa:lang";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === "en" ? "en" : "ne"; // Nepali is the default
    } catch {
      return "ne";
    }
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const t = useCallback((key: string, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  return useContext(Ctx);
}
