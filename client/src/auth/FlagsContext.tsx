import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { DEFAULT_FLAGS, flagsApi } from "../api/client";
import type { PublicFlags } from "../api/client";

const Ctx = createContext<PublicFlags>(DEFAULT_FLAGS);

export function FlagsProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<PublicFlags>(DEFAULT_FLAGS);
  useEffect(() => {
    let alive = true;
    flagsApi
      .getPublic()
      .then((f) => {
        if (alive) setFlags(f);
      })
      .catch(() => {
        /* defaults already set */
      });
    return () => {
      alive = false;
    };
  }, []);
  return <Ctx.Provider value={flags}>{children}</Ctx.Provider>;
}

export function useFlags(): PublicFlags {
  return useContext(Ctx);
}
