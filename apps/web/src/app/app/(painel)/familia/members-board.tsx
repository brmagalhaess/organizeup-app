"use client";
import { Check, Copy, Trash2, UserPlus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import type { ActionState } from "@/app/app/actions";
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
import { ROLE_HINT, ROLE_LABEL } from "@/lib/invites";
import { cancelInvite, inviteMember, leaveFamily, removeMember } from "./actions";

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  self: boolean;
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
  const [state, action, pending] = useActionState(inviteMember, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form onSubmit={submitKeeping(action)} className="flex flex-col gap-4">
      <Field
        label="E-mail da pessoa"
        hint="Ela precisa entrar com este e-mail para aceitar."
        error={state.fieldErrors?.email}
      >
        <Input name="email" type="email" autoComplete="off" required />
      </Field>
      <Field label="O que ela pode fazer" error={state.fieldErrors?.role}>
        <Select name="role" defaultValue="adult" required>
          <option value="adult">Ver e alterar os dados</option>
          <option value="viewer">Só ver</option>
        </Select>
      </Field>
      <FormMessage message={state.message} />
      <Button type="submit" disabled={pending}>
        {pending ? "Criando…" : "Criar convite"}
      </Button>
    </form>
  );
}

function CopyLink({ invite }: { invite: InviteRow }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input
        readOnly
        value={invite.link}
        aria-label={`Link do convite de ${invite.email}`}
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button
        type="button"
        variant="secondary"
        small
        onClick={async () => {
          await navigator.clipboard.writeText(invite.link);
          setCopied(true);
        }}
      >
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
        {copied ? "Copiado" : "Copiar"}
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
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const [cancelling, setCancelling] = useState<InviteRow | null>(null);
  const [leaving, setLeaving] = useState(false);

  return (
    <Card
      title="Quem acessa"
      description="Cada pessoa entra com o próprio login."
      actions={
        isOwner ? (
          <Button variant="secondary" small onClick={() => setInviting(true)}>
            <UserPlus className="size-4" aria-hidden="true" />
            Convidar
          </Button>
        ) : null
      }
    >
      <ul aria-label="Quem acessa" className="m-0 list-none divide-y divide-line p-0">
        {members.map((member) => (
          <li key={member.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{member.name}</p>
              <p className="truncate text-xs text-muted">{member.email}</p>
            </div>
            <Badge>{ROLE_LABEL[member.role] ?? member.role}</Badge>
            {isOwner && !member.self ? (
              <IconButton
                label={`Remover acesso de ${member.name}`}
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
          <h3 className="text-sm font-semibold">Convites aguardando</h3>
          <p className="mt-0.5 text-xs text-muted">
            Copie o link e envie para a pessoa, por mensagem. Ainda não enviamos e-mail.
          </p>
          <ul aria-label="Convites aguardando" className="m-0 mt-2 list-none p-0">
            {invites.map((invite) => (
              <li key={invite.id} className="flex flex-col gap-2 py-2">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{invite.email}</p>
                    <p className="text-xs text-muted">
                      {ROLE_HINT[invite.role] ?? invite.role}. Vale até {invite.expires}.
                    </p>
                  </div>
                  <IconButton
                    label={`Cancelar convite de ${invite.email}`}
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
          Sair desta família
        </Button>
      ) : null}

      <Sheet open={inviting} onClose={() => setInviting(false)} title="Convidar pessoa">
        <InviteForm onDone={() => setInviting(false)} />
      </Sheet>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remover acesso"
        text={`${removing?.name ?? ""} deixa de acessar esta família. Os dados continuam aqui.`}
        confirmLabel="Remover acesso"
        action={removeMember}
        hidden={{ id: removing?.id ?? "" }}
      />
      <ConfirmSheet
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title="Cancelar convite"
        text="O link deixa de funcionar."
        confirmLabel="Cancelar convite"
        action={cancelInvite}
        hidden={{ id: cancelling?.id ?? "" }}
      />
      <ConfirmSheet
        open={leaving}
        onClose={() => setLeaving(false)}
        title="Sair desta família"
        text="Você deixa de acessar os dados desta família. Para voltar, precisa de novo convite."
        confirmLabel="Sair da família"
        action={leaveFamily}
        hidden={{}}
      />
    </Card>
  );
}
