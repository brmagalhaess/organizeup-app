"use client";
// Formulário da concessão. O servidor confere tudo de novo: aqui só some o que não vale para a escolha feita.
import {
  BILLING_MODULES,
  CURRENCIES,
  MAX_VIP_DISCOUNT,
  MIN_VIP_DISCOUNT,
  VIP_REASONS,
  type VipScope,
} from "@organizeup/domain";
import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, FormMessage, Input, Select } from "@/components/ui";
import { MODULE_LABELS, VIP_REASON_LABELS } from "../../planos";
import { grantVip, type VipFormState } from "../actions";

function Options({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-medium">{legend}</legend>
      {children}
    </fieldset>
  );
}

function Option({
  type,
  name,
  value,
  label,
  checked,
  onChange,
}: {
  type: "radio" | "checkbox";
  name: string;
  value: string;
  label: string;
  checked?: boolean;
  onChange?: () => void;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line px-3 text-sm">
      <input
        type={type}
        name={name}
        value={value}
        className="size-5 shrink-0"
        {...(onChange ? { checked: checked ?? false, onChange } : {})}
      />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Concedendo..." : "Conceder VIP"}
    </Button>
  );
}

const EMPTY: VipFormState = { message: null };

export function VipForm({
  scope,
  families,
  userId,
  charged,
}: {
  scope: VipScope;
  families: Array<{ id: string; name: string }>;
  userId: string;
  /** A Stripe segue cobrando esta família. */
  charged: boolean;
}) {
  const [state, action] = useActionState(grantVip, EMPTY);
  // Com desconto, a família paga o plano dela: liberar mais que isso é escolha, nunca o padrão.
  const [access, setAccess] = useState<"tudo" | "escolhido" | "nada">(charged ? "nada" : "tudo");
  const [cost, setCost] = useState<"sem_custo" | "desconto">(charged ? "desconto" : "sem_custo");
  const [talks, setTalks] = useState(false);
  const only = families.length === 1 ? families[0] : undefined;

  return (
    <form action={action} className="flex max-w-xl flex-col gap-5">
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="userId" value={userId} />
      {only ? (
        <input type="hidden" name="householdId" value={only.id} />
      ) : (
        <Field label="Família" hint="Uma concessão vale para uma família só.">
          <Select name="householdId" required>
            {families.map((family) => (
              <option key={family.id} value={family.id}>
                {family.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Options legend="O que recebe">
        {cost === "desconto" ? (
          <Option
            type="radio"
            name="access"
            value="nada"
            label="Só o desconto: nada a mais que o plano dela"
            checked={access === "nada"}
            onChange={() => setAccess("nada")}
          />
        ) : null}
        <Option
          type="radio"
          name="access"
          value="tudo"
          label="Tudo liberado"
          checked={access === "tudo"}
          onChange={() => setAccess("tudo")}
        />
        <Option
          type="radio"
          name="access"
          value="escolhido"
          label="Módulos e limites escolhidos"
          checked={access === "escolhido"}
          onChange={() => setAccess("escolhido")}
        />
      </Options>

      {access === "escolhido" ? (
        <>
          <Options legend="Módulos">
            {BILLING_MODULES.map((module) =>
              module === "assistente" ? (
                <Option
                  key={module}
                  type="checkbox"
                  name="modules"
                  value={module}
                  label={MODULE_LABELS[module]}
                  checked={talks}
                  onChange={() => setTalks(!talks)}
                />
              ) : (
                <Option
                  key={module}
                  type="checkbox"
                  name="modules"
                  value={module}
                  label={MODULE_LABELS[module]}
                />
              ),
            )}
          </Options>
          <Field label="Lançamentos por mês" hint="Vazio: sem limite.">
            <Input name="entryLimit" type="number" min={0} max={999999} inputMode="numeric" />
          </Field>
          {talks ? (
            <Field label="Mensagens por mês" hint="Vazio: sem limite.">
              <Input name="messageLimit" type="number" min={0} max={999999} inputMode="numeric" />
            </Field>
          ) : null}
          <Options legend="Moedas adicionais">
            {CURRENCIES.map((currency) => (
              <Option
                key={currency}
                type="checkbox"
                name="currencies"
                value={currency}
                label={currency}
              />
            ))}
          </Options>
        </>
      ) : null}

      <Options legend="Custo">
        {charged ? (
          <p className="m-0 text-sm text-muted">
            A Stripe segue cobrando esta família. Sem custo só depois de cancelar a assinatura.
          </p>
        ) : (
          <Option
            type="radio"
            name="cost"
            value="sem_custo"
            label="Sem custo: não passa pela Stripe"
            checked={cost === "sem_custo"}
            onChange={() => {
              setCost("sem_custo");
              if (access === "nada") setAccess("tudo");
            }}
          />
        )}
        <Option
          type="radio"
          name="cost"
          value="desconto"
          label="Com desconto: a família assina na Stripe"
          checked={cost === "desconto"}
          onChange={() => {
            setCost("desconto");
            setAccess("nada");
          }}
        />
      </Options>

      {cost === "desconto" ? (
        <Field
          label="Desconto em %"
          hint="Só vale enquanto a assinatura paga. Sozinho, não libera nada. Ao vencer, o preço não sobe: tirar o desconto é uma ação sua."
        >
          <Input
            name="discountPercent"
            type="number"
            min={MIN_VIP_DISCOUNT}
            max={MAX_VIP_DISCOUNT}
            inputMode="numeric"
            required
          />
        </Field>
      ) : null}

      <Field label="Motivo" hint="Lista fechada, para não guardar nome de ninguém aqui.">
        <Select name="reason" required defaultValue="parceria">
          {VIP_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {VIP_REASON_LABELS[reason]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Válido até (opcional)" hint="Vazio: até alguém remover.">
        <Input name="endsOn" type="date" />
      </Field>

      <FormMessage message={state.message} />
      <div className="flex">
        <Submit />
      </div>
    </form>
  );
}
