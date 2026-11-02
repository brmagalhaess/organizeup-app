// CPF e CNPJ fictícios para os testes, com dígito verificador certo. Um novo a cada cadastro, porque o mesmo
// documento não abre duas contas. Começam em 000 para ficar fora das faixas em uso.
import { cnpjCheckDigits, cpfCheckDigits, formatCnpj, formatCpf } from "@organizeup/domain";

const digits = (size: number) =>
  Array.from({ length: size }, () => Math.floor(Math.random() * 10)).join("");

export function newCpf(): string {
  const base = `000${digits(6)}`;
  return formatCpf(base + cpfCheckDigits(base));
}

/** Alfanumérico, como os novos da Receita Federal, em formato com máscara. */
export function newCnpj(): string {
  const base = `00AB${digits(8)}`;
  return formatCnpj(base + cnpjCheckDigits(base));
}
