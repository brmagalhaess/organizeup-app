"use client";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Field, Select } from "@/components/ui";

export interface PickerOption {
  value: string;
  label: string;
}

/** Tipo, período e comparação. A escolha vai no endereço: dá para voltar e para compartilhar na família. */
export function ReportPicker({
  kind,
  period,
  compare,
  kinds,
  periods,
  labels,
}: {
  kind: string;
  period: string;
  compare: string;
  kinds: PickerOption[];
  periods: PickerOption[];
  labels: { kind: string; period: string; compare: string; none: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();

  const go = (next: { tipo: string; periodo?: string; comparar?: string }) => {
    const query = new URLSearchParams({ tipo: next.tipo });
    if (next.periodo) query.set("periodo", next.periodo);
    if (next.comparar) query.set("comparar", next.comparar);
    start(() => router.push(`${pathname}?${query.toString()}`));
  };

  return (
    <div className="grid gap-4 sm:grid-cols-3" aria-busy={pending}>
      <Field label={labels.kind}>
        <Select value={kind} onChange={(event) => go({ tipo: event.target.value })}>
          {kinds.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
      </Field>
      {periods.length > 0 ? (
        <>
          <Field label={labels.period}>
            <Select
              value={period}
              onChange={(event) => go({ tipo: kind, periodo: event.target.value })}
            >
              {periods.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={labels.compare}>
            <Select
              value={compare}
              onChange={(event) =>
                go({ tipo: kind, periodo: period, comparar: event.target.value })
              }
            >
              <option value="nenhum">{labels.none}</option>
              {periods
                .filter((item) => item.value !== period)
                .map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
            </Select>
          </Field>
        </>
      ) : null}
    </div>
  );
}
