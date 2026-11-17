"use client";
import { Check, Copy, Mail, Trash2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState, useTransition } from "react";
import type { ActionState } from "@/app/app/actions";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  Card,
  ConfirmSheet,
  Field,
  FormMessage,
  IconButton,
  Input,
  Select,
  Sheet,
  submitKeeping,
} from "@/components/ui";
import {
  cancelInvite,
  inviteMember,
  leaveFamily,
  removeMember,
  sendMemberConfirmation,
  setMemberEmails,
} from "./actions";

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  self: boolean;
  /** Avisos por e-mail ligados para esta pessoa. */
  emails: boolean;
  /** E-mail da conta confirmado: sem isso, nenhum aviso sai. */
  verified: boolean;
}

export interface InviteRow {
  id: string;
  email: string;
  role: string;
  expires: string;
  link: string;
}

const initial: ActionState = { ok: false, message: null };

function InviteForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations("pessoas.members");
  const [state, action, pending] = useActionState(inviteMember, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <Field label={t("email")} hint={t("emailHint")} error={state.fieldErrors?.email}>
        <Input name="email" type="email" autoComplete="off" required />
      </Field>
      <Field label={t("role")} error={state.fieldErrors?.role}>
        <Select name="role" defaultValue="adult" required>
          <option value="adult">{t("canEdit")}</option>
          <option value="viewer">{t("viewOnly")}</option>
        </Select>
      </Field>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? t("creating") : t("create")}
      </Button>
    </form>
  );
}

/** Liga ou desliga os avisos por e-mail de um convidado. E-mail sem confirmar: oferece mandar a confirmação. */
function MemberEmails({ member }: { member: MemberRow }) {
  const t = useTranslations("pessoas.members.emails");
  const [on, setOn] = useState(member.emails);
  const [state, setState] = useState<ActionState>(initial);
  const [pending, start] = useTransition();
  const run = (
    action: (form: FormData) => Promise<ActionState>,
    values: Record<string, string>,
  ) => {
    const form = new FormData();
    form.set("id", member.id);
    for (const [key, value] of Object.entries(values)) form.set(key, value);
    start(async () => {
      try {
        setState(await action(form));
      } catch {
        setState({ ok: false, message: t("failed") });
      }
    });
  };
  return (
    <div className="mt-2 flex flex-col gap-2">
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          aria-label={t("toggleAria", { name: member.name })}
          onChange={(event) => {
            const next = event.target.checked;
            setOn(next);
            run(setMemberEmails, { enabled: next ? "1" : "0" });
          }}
          className="size-4 shrink-0 accent-brand-500"
        />
        <Mail className="size-4 text-muted" aria-hidden="true" />
        {t("toggle")}
      </label>
      {on && !member.verified ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warning-soft px-3 py-2">
          <p className="m-0 min-w-0 flex-1 basis-56 text-xs text-warning">
            {t("unverified", { name: member.name })}
          </p>
          <Button
            variant="secondary"
            small
            disabled={pending}
            onClick={() => run(sendMemberConfirmation, {})}
          >
            {t("sendConfirmation")}
          </Button>
        </div>
      ) : null}
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
    </div>
  );
}

function CopyLink({ invite }: { invite: InviteRow }) {
  const t = useTranslations("pessoas.members");
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  return (
    <div className="flex items-center gap-2">
      <Input
        readOnly
        value={invite.link}
        aria-label={t("linkAria", { email: invite.email })}
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button
        type="button"
        variant="secondary"
        small
        onClick={async () => {
          await navigator.clipboard.writeText(invite.link);
          setCopied(true);
          toast?.show({ tone: "success", text: t("copied") });
        }}
      >
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
        {copied ? t("copied") : t("copy")}
      </Button>
    </div>
  );
}

export function MembersBoard({
  members,
  invites,
  isOwner,
}: {
  members: MemberRow[];
  invites: InviteRow[];
  isOwner: boolean;
}) {
  const t = useTranslations("pessoas.members");
  const tSettings = useTranslations("settings");
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const [cancelling, setCancelling] = useState<InviteRow | null>(null);
  const [leaving, setLeaving] = useState(false);

  return (
    <Card
      title={t("title")}
      description={t("description")}
      actions={
        isOwner ? (
          <Button variant="secondary" small onClick={() => setInviting(true)}>
            <UserPlus className="size-4" aria-hidden="true" />
            {t("invite")}
          </Button>
        ) : null
      }
    >
      <ul aria-label={t("title")} className="m-0 list-none divide-y divide-line p-0">
        {members.map((member) => (
          <li key={member.id} className="flex items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{member.name}</p>
              <p className="truncate text-xs text-muted">{member.email}</p>
              {isOwner && !member.self ? <MemberEmails member={member} /> : null}
            </div>
            <Badge>{tSettings(`roles.${member.role as "owner"}`)}</Badge>
            {isOwner && !member.self ? (
              <IconButton
                label={t("removeAria", { name: member.name })}
                onClick={() => setRemoving(member)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            ) : null}
          </li>
        ))}
      </ul>

      {isOwner && invites.length > 0 ? (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="text-sm font-semibold">{t("pending")}</h3>
          <p className="mt-0.5 text-xs text-muted">{t("pendingHelp")}</p>
          <ul aria-label={t("pending")} className="m-0 mt-2 list-none p-0">
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-col gap-2 py-2">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{invite.email}</p>
                    <p className="text-xs text-muted">
                      {t("inviteStatus", { role: invite.role, expires: invite.expires })}
                    </p>
                  </div>
                  <IconButton
                    label={t("cancelAria", { email: invite.email })}
                    onClick={() => setCancelling(invite)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </IconButton>
                </div>
                <CopyLink invite={invite} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!isOwner ? (
        <Button variant="secondary" small className="mt-4" onClick={() => setLeaving(true)}>
          {t("leave")}
        </Button>
      ) : null}

      <Sheet open={inviting} onClose={() => setInviting(false)} title={t("inviteTitle")}>
        <InviteForm onDone={() => setInviting(false)} />
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("removeTitle")}
        text={t("removeText", { name: removing?.name ?? "" })}
        confirmLabel={t("removeConfirm")}
        action={removeMember}
        hidden={{ id: removing?.id ?? "" }}
      />
      <ConfirmSheet
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title={t("cancelTitle")}
        text={t("cancelText")}
        confirmLabel={t("cancelConfirm")}
        action={cancelInvite}
        hidden={{ id: cancelling?.id ?? "" }}
      />
      <ConfirmSheet
        open={leaving}
        onClose={() => setLeaving(false)}
        title={t("leaveTitle")}
        text={t("leaveText")}
        confirmLabel={t("leaveConfirm")}
        action={leaveFamily}
        hidden={{}}
      />
    </Card>
  );
}
