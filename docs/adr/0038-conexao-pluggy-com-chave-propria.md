# ADR-0038: Conexão com bancos pela Pluggy, com a chave de cada pessoa

- Status: aceito, em liberação por etapas (chave `bank_feed_enabled`, desligada)
- Data: 2026-11-11
- Pedido do fundador em 2026-11-11

## Contexto

`docs/specs/conexao-de-contas.md` deixou o Open Finance para quando houver 126 conexões pagas, porque o plano de
produto da Pluggy parte de R$ 2.500 por mês. A Pluggy tem também o **Meu Pluggy**, um plano pessoal gratuito: a
pessoa conecta até 5 contas em seu próprio nome, cria uma aplicação no painel e lê os próprios dados pela API com
o Client ID e o Client Secret dela. É o caminho que o Actual Budget usa.

O fundador pediu para o OrganizeUp aceitar a chave de cada pessoa: ela se cadastra na Pluggy, gera a chave e
informa aqui, e o sistema passa a trazer receitas, despesas e investimentos.

## Decisão

1. **Cada chave é de uma pessoa do cadastro.** Uma chave por pessoa e por família (`bank_connections`, com
   `person_id`). Quem está logado guarda até duas: a sua e a de outra pessoa adulta do cadastro, pedido do
   fundador em 2026-11-11 para o casal usar um login só. A chave da outra pessoa é criada por ela, na conta
   dela na Pluggy, e quem guarda marca que ela autorizou; a gravação fica na auditoria. Menor de idade não
   conecta. Só o login que guardou a chave vê, busca e remove; outro login da mesma família não enxerga nem as
   contas ligadas, e não consegue guardar outra chave para a mesma pessoa.
2. **Chaves cifradas.** Client ID e Client Secret ficam em AES-256-GCM (`lib/connection-vault.ts`), com a família,
   a pessoa e o campo como dado autenticado, e com chave derivada de `DOCUMENT_ENCRYPTION_KEY` por um rótulo só
   deste cofre. Nenhuma senha de banco passa pelo OrganizeUp. As chaves só são abertas no servidor, a pedido da
   própria pessoa. Elas não entram na exportação de dados. A conexão também entra no dado autenticado: quem
   guarda duas chaves não abre uma no lugar da outra.
3. **Nada entra sozinho.** A Pluggy alimenta as telas de importar que já existem. Lançamentos de uma conta ligada
   entram na conferência de `/app/importar` como se fossem um OFX, com o identificador da Pluggy na impressão
   digital (`ofx:id:pluggy:<id>`), então a mesma linha não entra duas vezes. A posição em ações, FIIs, ETFs e BDRs
   entra na conferência de `/app/investimentos/importar` como a planilha de Posição da B3, com o preço médio já
   preenchido quando a instituição informa quanto foi aplicado. Cota do plano, categorização, conciliação com o
   previsto e Desfazer continuam os mesmos.
4. **Uma conta daqui recebe uma conta do banco só** (índice único em `bank_connection_accounts`). Duas contas
   do banco na mesma conta do OrganizeUp embaralhariam a conferência, venham da mesma chave ou de chaves
   diferentes. Cada conta ligada mostra de quem é a chave. Conta conjunta aparece nas duas chaves: a tela avisa
   para ligar só uma. A posição em bolsa das duas chaves é somada por código, porque a carteira é da família.
5. **Busca a pedido da pessoa, na web.** Não há job diário nesta etapa. A Pluggy é chamada fora de
   `withHousehold` (regra 9). Lançamento pendente no banco não entra; a busca seguinte refaz os últimos 7 dias.
6. **Só o código do erro é guardado** (`error_code`), nunca o texto da Pluggy ou do banco.
7. **Liberação por etapas.** `bank_feed_enabled` nasce desligada: só o admin do serviço vê a tela. Quem liga é o
   painel (`/admin/cobranca`), com auditoria.

## Onde a pessoa acha

"Conexão com bancos" fica no menu lateral, logo abaixo de Contas, para quem pode usar. Há atalhos em Contas,
Importar extrato, Importar investimentos e Cartões (este só avisa que o cartão ainda não entra). O passo a passo
da tela usa os nomes do painel da Pluggy conferidos em 2026-11-11: Aplicações, Novo, Credenciais, "Gerar novo
secret" (o Client Secret aparece uma vez só), ícone Demo, "Conectar Conta" e "Itens Conectados".

## Riscos aceitos e o que falta antes de ligar para todos

- **Termos da Pluggy.** A página do Meu Pluggy diz que o plano gratuito é para uso pessoal e que usar os dados em
  um produto para terceiros, ou uso comercial, exige plano pago. Aqui cada pessoa lê os próprios dados com a
  própria chave, mas dentro de um produto pago. Isso precisa de confirmação por escrito da Pluggy
  (sales@pluggy.ai) antes de a chave ser ligada para todas as famílias. Enquanto só o fundador usa, com a conta
  dele, é uso pessoal. A mesma página diz que conectar conta de cônjuge ou familiar não cabe no plano gratuito:
  por isso a segunda chave é sempre de outra conta na Pluggy, criada pela própria pessoa, e nunca a conta
  dela dentro da chave de quem está logado.
- **Regra da spec alterada.** `conexao-de-contas.md` dizia que ninguém conecta a conta de um familiar no lugar
  dele. A decisão de 2026-11-11 abre a exceção acima, com a confirmação de autorização.
- **Política de Privacidade.** A spec exige atualizá-la antes da primeira conexão de um cliente.
- **Resolução Conjunta 21 (entidade parceira).** Continua para validar com advogado, como na spec.
- **Nunca rodou com chave real.** O cliente foi escrito a partir da documentação e do SDK público da Pluggy, e
  testado com respostas simuladas. O primeiro uso com chave real é a verificação que falta.

## Fora desta etapa

- Cartão de crédito: a conta aparece na lista, mas não é trazida.
- Renda fixa, fundos e previdência: aparecem como ignorados na conferência, com o motivo.
- Histórico de compras e vendas pela Pluggy: só a posição atual.
- Busca automática diária e o conector embutido (Pluggy Connect), que dispensaria copiar o Item ID.

## Se o OrganizeUp contratar o plano de produto

A leitura, o mapeamento (`packages/domain/src/bank-feed.ts`) e a conferência servem do mesmo jeito. Muda só de
onde vêm as chaves: da aplicação do OrganizeUp, e não da pessoa.
