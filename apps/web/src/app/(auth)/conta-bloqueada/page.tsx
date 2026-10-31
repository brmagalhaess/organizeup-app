import type { Metadata } from "next";

export const metadata: Metadata = { title: "Conta bloqueada" };

export default function BlockedAccountPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Esta conta está bloqueada</h1>
      <p className="mt-2 text-sm text-muted">
        O acesso foi bloqueado pela administração do OrganizeUp. Seus dados continuam guardados.
        Para saber mais, fale com o suporte.
      </p>
    </div>
  );
}
