# ADR-0006 — Importação de extrato

Status: aceito (2026-10-30)

## Decisão

- **O arquivo não sai do navegador.** OFX e CSV são lidos no cliente (`packages/domain/src/statement.ts`) e
  só as linhas vão ao servidor, validadas com zod. Nada do arquivo é guardado, e o lote não registra o
  nome dele, que pode conter número da conta. Assim não há armazenamento de arquivos para proteger.
- **Importar não duplica.** Cada linha tem uma identidade (`import_fingerprint`): o `FITID` do OFX, o
  identificador do banco no CSV, ou data + valor + descrição normalizada com contador para compras iguais no
  mesmo dia. `UNIQUE (household_id, account_id, import_fingerprint)` garante isso no banco.
- **Conciliação antes de gravar** (`reconcileRows`), com a família revisando tudo:
  - `previsto`: mesmo valor e sentido, na mesma conta, até 5 dias de uma previsão, parcela ou fatura em aberto.
    Marcado por padrão: dá baixa nela em vez de criar outro lançamento.
  - `lancado`: mesmo valor até 3 dias de um lançamento realizado. Desmarcado por padrão.
  - `importado`: já está no sistema. Não pode ser selecionado.
  - `novo`: entra como lançamento realizado.
- **Baixa usa o mesmo caminho do botão Pagar** (`lib/confirm-entry.ts`), então parcela e fatura ficam ligadas
  ao lançamento da mesma forma.
- **Categorias** são sugestão do agente de categorização (ADR-0013). A categoria do cartão fica de fora.
- **Desfazer por lote** (`import_batches`): apaga o que o lote criou, inclusive o que foi editado depois.
  Lançamento que já existia e só recebeu a baixa volta a ser previsto, e parcelas e faturas reabrem pela FK.
- **Limites**: 5 MB e 2.000 linhas por arquivo. `serverActions.bodySizeLimit` em 3 MB comporta o pior caso.

## Fora do escopo por enquanto

Fatura de cartão. Transferência entre contas da própria família aparece como despesa numa e
receita noutra. Conta de valor variável, como luz, não dá baixa sozinha, porque a regra exige valor igual.
