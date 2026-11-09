# ADR-0009 — Renda

Status: aceito (2026-10-30)

## Decisão

- **Tabelas como dados** (`fiscal_parameters`): uma linha por vigência, global e somente leitura para a
  aplicação, como `category_templates`. Tabela nova entra por migração. Sem tabela nova publicada, vale a
  mais recente. O cálculo fica em `packages/domain/src/income.ts` e recebe a tabela como parâmetro.
- **Fontes dos valores de 2026**:
  - INSS: Portaria Interministerial MPS/MF nº 13, de 09/01/2026.
  - IRRF, dependente e desconto simplificado: Receita Federal, página "Tributação de 2026".
  - Redução: Lei nº 15.270/2025 e orientação da Receita às fontes pagadoras, de dezembro de 2025. Os dois
    exemplos dessa orientação (R$ 4.500 e R$ 6.000) são testes automáticos.
  - 13º: Lei nº 15.270/2025, § 3º, e Perguntas e Respostas IRPF 2026, pergunta 332.
- **IR**: usa o maior entre deduções legais (INSS, dependentes e pensão) e desconto simplificado. A faixa da
  redução olha o rendimento tributável, não a base depois das deduções, e a redução nunca passa do imposto.
- **13º**: um ano inteiro de trabalho. Metade em 30/11 sem descontos; INSS e IR do valor inteiro saem da 2ª
  parcela, em 20/12. Imposto separado do salário, com a mesma escolha de deduções e com a redução.
- **Férias**: 30 dias, salário + 1/3, no lugar do salário daquele mês.
- **Previsão, não lançamento**: `monthIncome` calcula as ocorrências, que entram em `buildMonthEntries` como
  `ScheduledEntry`. Assim o mês, o calendário, os vencimentos e a importação de extrato usam a renda sem
  código novo. Receber cria um lançamento e um `income_receipts`, que tira a previsão do mês. Apagar o
  lançamento devolve a previsão, e a chave única impede receber duas vezes.
- **Início** (revisto em 2026-11-09, a pedido do fundador): a renda aparece em todo mês desde o mês do
  cadastro até ser encerrada, mesmo que o dia do pagamento já tenha passado. O que já caiu na conta a família
  marca como recebido ("Receber"); a previsão atrasada é o aviso para isso, não um erro. O primeiro mês fica
  editável em "Prevista desde" para corrigir rendas criadas pela regra anterior, que começavam no mês
  seguinte e deixavam o mês do cadastro sem salário no painel e em Lançamentos.
- **Só a CLT é calculada**. Nos outros tipos, o valor informado é o que cai na conta.

## Ponto em aberto: redução nas férias

Conferido de novo em 2026-11-02 (ADR-0028), sem novidade.
Não achamos fonte oficial sobre como a redução se aplica às férias. A orientação de dezembro de 2025 não fala
do assunto, e o Perguntas e Respostas IRPF 2026 também não. A lei fala em rendimentos sujeitos à incidência
mensal, o que sugere que a redução vale, mas isso é leitura nossa. Por isso, a previsão do mês usa o valor
**sem** a redução, que é o menor, e a tela mostra até quanto pode vir. Quando a Receita orientar, basta
trocar o valor usado em `monthIncome`.

## Fora do escopo por enquanto

13º proporcional, férias divididas ou vendidas e 13º adiantado nas férias saíram desta lista com o ADR-0028.
Horas extras, adicionais, FGTS, previdência privada e IR de PJ ou autônomo. Com duas fontes pagadoras, cada
uma é calculada sozinha, como na retenção, e a diferença aparece só no ajuste anual. O 13º de aposentados
não é previsto. Tabelas de 2027 precisam de nova migração em janeiro.
