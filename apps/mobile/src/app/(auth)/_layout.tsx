import { Redirect, Stack } from "expo-router";
import { authClient } from "@/lib/auth";

export default function AuthLayout() {
  const { data: session } = authClient.useSession();
  if (session) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
