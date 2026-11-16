// Quem está no app e com qual família aberta. Uma leitura só, compartilhada pelas telas.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, apiGet, type Family, type Me } from "./api";
import { authClient } from "./auth";

interface MeState {
  me: Me | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
  openFamily: (id: string) => Promise<void>;
}

const MeContext = createContext<MeState | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      let next = await apiGet<Me>("/me");
      // Sessão nova não tem família aberta. Com uma só, abre sozinho, como o site faz.
      const usable = next.families.filter((family) => !family.suspended);
      if (!next.family && next.families.length === 1 && usable[0]) {
        await authClient.organization.setActive({ organizationId: usable[0].id });
        next = await apiGet<Me>("/me");
      }
      setMe(next);
      setError(null);
    } catch (caught) {
      const failure = caught instanceof ApiError ? caught : new ApiError("server", 0);
      if (failure.code === "unauthenticated") void authClient.signOut();
      setError(failure);
    } finally {
      setLoading(false);
    }
  }, []);

  const openFamily = useCallback(
    async (id: string) => {
      setLoading(true);
      await authClient.organization.setActive({ organizationId: id });
      await reload();
    },
    [reload],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <MeContext.Provider value={{ me, error, loading, reload, openFamily }}>
      {children}
    </MeContext.Provider>
  );
}

export function useMe(): MeState {
  const state = useContext(MeContext);
  if (!state) throw new Error("useMe fora do MeProvider");
  return state;
}

/** Dentro das abas a família já está aberta: o layout garante. */
export function useFamily(): Family {
  const { me } = useMe();
  if (!me?.family) throw new Error("tela de família sem família aberta");
  return me.family;
}
