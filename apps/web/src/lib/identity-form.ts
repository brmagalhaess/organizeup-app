// Leitura do formulário do documento, a mesma no cadastro e em /app/completar.

/** Vira a entrada de `parseIdentity`. Sem escolha de país, `inBrazil` fica null e a validação recusa. */
export function identityFromForm(form: FormData) {
  const country = form.get("country");
  return {
    inBrazil: country === "BR" ? true : country === "outro" ? false : null,
    personType: form.get("personType"),
    cpf: form.get("cpf"),
    cnpj: form.get("cnpj"),
    companyName: form.get("companyName"),
  };
}
