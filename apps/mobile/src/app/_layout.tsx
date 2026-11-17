import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const theme = useTheme();
  const { isPending } = authClient.useSession();
  // Só a primeira leitura da sessão segura a tela. Depois, a sessão é relida a cada volta do app ao
  // primeiro plano, e sem sessão (como na tela do código de 2 fatores) ela volta a "pendente": se a
  // navegação sumisse nesse momento, quem saiu para pegar o código voltaria para o login.
  const [ready, setReady] = useState(false);

  // A abertura fica até a sessão guardada ser lida: ninguém vê o login piscar antes do painel.
  useEffect(() => {
    if (!isPending && !ready) {
      setReady(true);
      void SplashScreen.hideAsync();
    }
  }, [isPending, ready]);

  if (!ready) return null;
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}
      />
    </>
  );
}
