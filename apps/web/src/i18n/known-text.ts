// Agentes, domínio e esquemas compartilhados ainda devolvem frase pronta em português (ADR-0020, Fase 3).
// O catálogo guarda a mesma frase: achada a chave em português, sai o texto do idioma da pessoa. Frase
// desconhecida segue em português, nunca em branco.

type Texts = Readonly<Record<string, string>>;

/** Tradução de `text` por um grupo de textos: `base` em português, `own` no idioma da pessoa. */
export function knownText(text: string, base: Texts, own: Texts): string {
  const key = Object.keys(base).find((name) => base[name] === text);
  return (key && own[key]) || text;
}
