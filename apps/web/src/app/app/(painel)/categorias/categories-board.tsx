"use client";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Field,
  FormMessage,
  IconButton,
  Input,
  Select,
  Sheet,
} from "@/components/ui";
import { systemTextOf } from "@/i18n/system-text";
import { saveCategory, setCategoryArchived, type CategoryFormState } from "./actions";

export interface CategoryRow {
  id: string;
  name: string;
  kind: "receita" | "despesa";
  essential: boolean;
  archived: boolean;
  /** Metas e aportes: dinheiro guardado, fora de despesas e receitas. */
  saving: boolean;
}

const initial: CategoryFormState = { ok: false, message: null };

function CategoryForm({
  category,
  kind,
  onDone,
}: {
  category: CategoryRow | null;
  kind: "receita" | "despesa";
  onDone: () => void;
}) {
  const t = useTranslations("categorias.form");
  const tCommon = useTranslations("common");
  const system = systemTextOf(useTranslations("sistema"));
  const [state, action, pending] = useActionState(saveCategory, initial);
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={category?.id ?? ""} />
      <Field label={t("name")}>
        <Input
          name="name"
          required
          maxLength={60}
          placeholder={t("nameExample")}
          defaultValue={category ? system.name(category.name) : undefined}
        />
      </Field>
      {category ? (
        <input type="hidden" name="kind" value={category.kind} />
      ) : (
        <Field label={t("type")}>
          <Select name="kind" defaultValue={kind}>
            <option value="despesa">{t("expense")}</option>
            <option value="receita">{t("income")}</option>
          </Select>
        </Field>
      )}
      {category?.saving ? (
        <p className="m-0 text-sm text-muted">{t("savingHint")}</p>
      ) : (
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="essential"
            defaultChecked={category?.essential}
            className="size-5 accent-brand-500"
          />
          {t("essential")}
        </label>
      )}
      <FormMessage message={state.message} tone={state.ok ? "ok" : "error"} />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon("saving") : t("save")}
      </Button>
    </form>
  );
}

function Group({
  title,
  rows,
  writable,
  onEdit,
}: {
  title: string;
  rows: CategoryRow[];
  writable: boolean;
  onEdit: (category: CategoryRow) => void;
}) {
  const t = useTranslations("categorias");
  const system = systemTextOf(useTranslations("sistema"));
  return (
    <Card title={title} description={t("count", { count: rows.length })}>
      <ul aria-label={title} className="m-0 list-none divide-y divide-line p-0">
        {rows.map((category) => (
          <li key={category.id} className="flex items-center gap-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {system.name(category.name)}
            </span>
            {category.saving ? (
              <Badge>{t(category.kind === "despesa" ? "savingOut" : "savingIn")}</Badge>
            ) : category.essential ? (
              <Badge>{t("essential")}</Badge>
            ) : null}
            {writable ? (
              <div className="flex shrink-0">
                <IconButton
                  label={t("actions.edit", { name: system.name(category.name) })}
                  onClick={() => onEdit(category)}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </IconButton>
                <form action={setCategoryArchived}>
                  <input type="hidden" name="id" value={category.id} />
                  <input type="hidden" name="archived" value="true" />
                  <IconButton
                    type="submit"
                    label={t("actions.archive", { name: system.name(category.name) })}
                  >
                    <Archive className="size-4" aria-hidden="true" />
                  </IconButton>
                </form>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function CategoriesBoard({ rows, writable }: { rows: CategoryRow[]; writable: boolean }) {
  const t = useTranslations("categorias");
  const system = systemTextOf(useTranslations("sistema"));
  const [editing, setEditing] = useState<{ nonce: number; category: CategoryRow | null } | null>(
    null,
  );
  const active = rows.filter((row) => !row.archived);
  const archived = rows.filter((row) => row.archived);
  const close = () => setEditing(null);
  const open = (category: CategoryRow | null) =>
    setEditing((s) => ({ nonce: (s?.nonce ?? 0) + 1, category }));

  return (
    <>
      {writable ? (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => open(null)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("new")}
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Group
          title={t("expenses")}
          rows={active.filter((row) => row.kind === "despesa")}
          writable={writable}
          onEdit={open}
        />
        <Group
          title={t("income")}
          rows={active.filter((row) => row.kind === "receita")}
          writable={writable}
          onEdit={open}
        />
      </div>

      {archived.length > 0 ? (
        <Card title={t("archived.title")} description={t("archived.text")}>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {archived.map((category) => (
              <li key={category.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="truncate text-sm">{system.name(category.name)}</span>
                {writable ? (
                  <form action={setCategoryArchived}>
                    <input type="hidden" name="id" value={category.id} />
                    <input type="hidden" name="archived" value="false" />
                    <IconButton
                      type="submit"
                      label={t("actions.restore", { name: system.name(category.name) })}
                    >
                      <ArchiveRestore className="size-4" aria-hidden="true" />
                    </IconButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Sheet
        open={editing !== null}
        onClose={close}
        title={t(editing?.category ? "sheet.edit" : "sheet.new")}
      >
        <CategoryForm
          key={editing?.nonce}
          category={editing?.category ?? null}
          kind="despesa"
          onDone={close}
        />
      </Sheet>
    </>
  );
}
