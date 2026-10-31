import Link from "next/link";
import { buttonClass } from "@/components/styles";

export default function AdminNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-10 text-center">
      <h2 className="text-2xl font-bold">Página não encontrada</h2>
      <p className="text-sm text-muted">Esta página não existe ou não está disponível.</p>
      <Link href="/app" className={buttonClass("secondary")}>
        Voltar ao app
      </Link>
    </div>
  );
}
