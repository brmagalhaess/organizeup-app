import type { Metadata } from "next";
import { CreateHouseholdForm } from "./create-household-form";

export const metadata: Metadata = { title: "Nova família" };

export default function NewHouseholdPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Crie o espaço da sua família</h1>
        <p className="text-sm text-muted">
          É aqui que ficam receitas, despesas, objetivos e o plano de aposentadoria. Só quem você
          convidar terá acesso.
        </p>
      </div>
      <CreateHouseholdForm />
    </div>
  );
}
