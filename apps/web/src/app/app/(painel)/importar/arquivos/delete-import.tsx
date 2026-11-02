"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ConfirmSheet } from "@/components/ui";
import { removeImport } from "./actions";

export function DeleteImport({ id }: { id: string }) {
  const t = useTranslations("importador.list");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" small variant="secondary" onClick={() => setOpen(true)}>
        {t("delete")}
      </Button>
      <ConfirmSheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("deleteTitle")}
        text={t("deleteText")}
        confirmLabel={t("deleteConfirm")}
        action={removeImport}
        hidden={{ id }}
      />
    </>
  );
}
