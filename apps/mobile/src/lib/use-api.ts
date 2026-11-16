import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ApiError, apiGet } from "./api";
import { authClient } from "./auth";

interface State<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  refreshing: boolean;
}

/**
 * Lê uma rota e relê sempre que a tela volta ao foco (depois de lançar algo, por exemplo). Sessão
 * vencida derruba o login: a tela de entrar aparece sozinha.
 */
export function useApi<T>(path: string) {
  const [state, setState] = useState<State<T>>({
    data: null,
    error: null,
    loading: true,
    refreshing: false,
  });
  const latest = useRef(path);
  latest.current = path;

  const load = useCallback(
    async (pulled: boolean) => {
      setState((current) => ({ ...current, loading: !current.data, refreshing: pulled }));
      try {
        const data = await apiGet<T>(path);
        if (latest.current !== path) return;
        setState({ data, error: null, loading: false, refreshing: false });
      } catch (caught) {
        const error = caught instanceof ApiError ? caught : new ApiError("server", 0);
        if (error.code === "unauthenticated") void authClient.signOut();
        if (latest.current !== path) return;
        setState((current) => ({ ...current, error, loading: false, refreshing: false }));
      }
    },
    [path],
  );

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  return { ...state, refresh: () => load(true) };
}
