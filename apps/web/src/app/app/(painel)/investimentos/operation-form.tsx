"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field, Select } from "@/components/ui";
import { AddAssetForm } from "./add-asset-form";
import type { Data } from "./shared";
import { TradeForm } from "./trade-form";

const NEW = "__novo__";

/**
 * Uma entrada só para qualquer operação: a pessoa escolhe um investimento que já tem (compra, venda,
 * aporte ou resgate) ou diz que é um investimento novo, e aí o ativo e a primeira compra nascem juntos.
 * Substitui os dois botões antigos, "Novo investimento" e "Nova operação".
 */
export function OperationForm({
  data,
  assetId,
  onDone,
}: {
  data: Data;
  /** Investimento já escolhido (botão da linha); null abre a lista. */
  assetId: string | null;
  onDone: () => void;
}) {
  const t = useTranslations("investimentos.operation");
  const [target, setTarget] = useState(assetId ?? (data.rows.length > 0 ? "" : NEW));
  const row = data.rows.find((item) => item.id === target) ?? null;
  return (
    <div className="flex flex-col gap-4">
      {data.rows.length > 0 ? (
        <Field label={t("which")} hint={target === NEW ? t("newHint") : undefined}>
          <Select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">{t("choose")}</option>
            {data.rows.map((item) => (
              <option key={item.id} value={item.id}>
                {item.ticker ? `${item.ticker} · ${item.name}` : item.name}
              </option>
            ))}
            <option value={NEW}>{t("newOption")}</option>
          </Select>
        </Field>
      ) : (
        <p className="m-0 text-sm text-muted">{t("firstHint")}</p>
      )}
      {target === NEW ? (
        <AddAssetForm key="new" today={data.today} accounts={data.accounts} onDone={onDone} />
      ) : row ? (
        <TradeForm
          key={row.id}
          row={row}
          accounts={data.accounts}
          today={data.today}
          onDone={onDone}
        />
      ) : null}
    </div>
  );
}
