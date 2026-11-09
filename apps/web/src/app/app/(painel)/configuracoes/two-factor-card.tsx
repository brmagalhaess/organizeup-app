"use client";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Field, FormMessage, Input, Sheet } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

type Step =
  | { kind: "senha" }
  | { kind: "confirmar"; totpURI: string; backupCodes: string[]; qr: string | null }
  | { kind: "pronto"; backupCodes: string[] };

/** Chave manual do otpauth://, para quem não consegue ler o QR. */
function secretOf(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

function EnableFlow({ onDone }: { onDone: () => void }) {
  const t = useTranslations("settings.twoFactor");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "senha" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (step.kind !== "confirmar" || step.qr) return;
    let alive = true;
    QRCode.toDataURL(step.totpURI, { margin: 1, width: 220 })
      .then((qr) => {
        if (alive) setStep((current) => (current.kind === "confirmar" ? { ...current, qr } : current));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [step]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const { data, error: failure } = await authClient.twoFactor.enable({
      password: String(form.get("password") ?? ""),
      issuer: "OrganizeUp",
    });
    setPending(false);
    if (failure || !data || !("totpURI" in data) || !data.totpURI) {
      setError(failure?.code === "INVALID_PASSWORD" ? t("wrongPassword") : t("failed"));
      return;
    }
    setStep({ kind: "confirmar", totpURI: data.totpURI, backupCodes: data.backupCodes, qr: null });
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step.kind !== "confirmar") return;
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const { error: failure } = await authClient.twoFactor.verifyTotp({
      code: String(form.get("code") ?? "").replace(/\s+/g, ""),
    });
    setPending(false);
    if (failure) {
      setError(t("codeInvalid"));
      return;
    }
    setStep({ kind: "pronto", backupCodes: step.backupCodes });
    router.refresh();
  }

  if (step.kind === "senha") {
    return (
      <form onSubmit={start} className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t("enableText")}</p>
        <Field label={t("password")}>
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <FormMessage message={error} />
        <Button type="submit" disabled={pending}>
          {pending ? tCommon("loadingEllipsis") : t("continue")}
        </Button>
      </form>
    );
  }

  if (step.kind === "confirmar") {
    const secret = secretOf(step.totpURI);
    return (
      <form onSubmit={confirm} className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t("scanText")}</p>
        <div className="flex justify-center rounded-lg border border-line bg-white p-3">
          {step.qr ? (
            // Data URL gerada no navegador: não passa pelo otimizador do Next.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={step.qr} alt={t("qrAlt")} width={220} height={220} />
          ) : (
            <span className="text-sm text-muted">{tCommon("loadingEllipsis")}</span>
          )}
        </div>
        {secret ? (
          <p className="text-xs text-muted">
            {t("manualKey")} <code className="select-all break-all font-mono">{secret}</code>
          </p>
        ) : null}
        <Field label={t("confirmLabel")} hint={t("codeHint")}>
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus />
        </Field>
        <FormMessage message={error} />
        <Button type="submit" disabled={pending}>
          {pending ? tCommon("loadingEllipsis") : t("activate")}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FormMessage message={t("activated")} tone="ok" />
      <p className="text-sm text-muted">{t("backupText")}</p>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 font-mono text-sm">
        {step.backupCodes.map((code) => (
          <li key={code} className="select-all rounded border border-line bg-card-soft px-2 py-1">
            {code}
          </li>
        ))}
      </ul>
      <Button type="button" onClick={onDone}>
        {t("savedCodes")}
      </Button>
    </div>
  );
}

function DisableFlow({ onDone }: { onDone: () => void }) {
  const t = useTranslations("settings.twoFactor");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const { error: failure } = await authClient.twoFactor.disable({
      password: String(form.get("password") ?? ""),
    });
    setPending(false);
    if (failure) {
      setError(failure.code === "INVALID_PASSWORD" ? t("wrongPassword") : t("failed"));
      return;
    }
    router.refresh();
    onDone();
  }

  return (
    <form onSubmit={disable} className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t("disableText")}</p>
      <Field label={t("password")}>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <FormMessage message={error} />
      <Button type="submit" variant="danger" disabled={pending}>
        {pending ? tCommon("loadingEllipsis") : t("disable")}
      </Button>
    </form>
  );
}

/** Card de Configurações: estado do segundo fator, ativar com QR e códigos de reserva, desativar. */
export function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const t = useTranslations("settings.twoFactor");
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {enabled ? (
          <Badge tone="success">
            <ShieldCheck className="mr-1 inline size-3.5" aria-hidden="true" />
            {t("statusOn")}
          </Badge>
        ) : (
          <Badge tone="warning">
            <ShieldOff className="mr-1 inline size-3.5" aria-hidden="true" />
            {t("statusOff")}
          </Badge>
        )}
        <Button variant={enabled ? "secondary" : "primary"} small onClick={() => setOpen(true)}>
          {enabled ? t("disable") : t("enable")}
        </Button>
      </div>
      <p className="mt-3 text-sm text-muted">{enabled ? t("onText") : t("offText")}</p>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={enabled ? t("disable") : t("enable")}
      >
        {enabled ? (
          <DisableFlow onDone={() => setOpen(false)} />
        ) : (
          <EnableFlow onDone={() => setOpen(false)} />
        )}
      </Sheet>
    </>
  );
}
