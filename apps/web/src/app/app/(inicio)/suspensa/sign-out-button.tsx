"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const t = useTranslations("familiaOnboarding.suspended");
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      className="self-start"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/entrar");
        router.refresh();
      }}
    >
      {t("signOut")}
    </Button>
  );
}
