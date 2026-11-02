# ADR-0022 — Documento da conta, pessoa física e pessoa jurídica

Status: aceito (2026-11-01). Pedido do fundador: "vamos aceitar cadastro de pessoa física e de pessoa jurídica também, e no
cadastro precisa ter o CPF", e depois "PF e PJ: um tem família e o outro tem sócio".

Soma ao ADR-0002 (isolamento), ao ADR-0011 (exportação e exclusão), ao ADR-0016 (painel e cadastro complementar) e ao
ADR-0020 (catálogos).

## Decisão

### Documento

- **CPF obrigatório para quem mora no Brasil.** Pessoa física: CPF. Pessoa jurídica: CNPJ, razão social e o CPF de quem está
  cadastrando. **Outro país:** o campo some, e a resposta fica guardada. É o menor desenho que resolve moeda fora do real e
  pessoa de fora: `Brasil` ou `Outro país` no cadastro, independente da moeda, que é da família e se escolhe depois. Em
  português o Brasil vem marcado; em inglês e espanhol, outro país.
- **Validação em `packages/domain/documents.ts`**, igual no navegador e no servidor. CNPJ alfanumérico conforme a Receita
  Federal (IN RFB 2.229/2024, novas inscrições desde julho de 2026): 12 posições com algarismos ou letras maiúsculas e 2
  dígitos verificadores numéricos; módulo 11, com cada caractere valendo o código ASCII menos 48. O exemplo oficial,
  12.ABC.345/01DE-35, com somas 459 e 424, está no teste. Fontes: Receita Federal, "Cálculo do DV do CNPJ Alfanumérico";
  Serpro, "Cálculo dos dígitos verificadores de CNPJ alfanumérico". Letra minúscula vira maiúscula ao normalizar.
- **Limite da regra da Receita.** Nos dígitos verificadores, nenhuma troca passa. Nos 9 primeiros do CPF, o módulo 11 leva os
  restos 0 e 1 ao mesmo dígito, e uma troca rara fecha a conta. Nenhum validador resolve isso.
- **Conta antiga:** o pedido aparece uma vez, no aviso do painel e em `/app/completar`, sem bloquear. "Agora não" ou "Não
  mostrar mais" gravam a dispensa, e o documento continua em Configurações. Vale para qualquer papel, porque o documento é da
  pessoa. A assinatura vai exigir, depois.

### Guarda

- **`user_identity`, uma linha por conta**, com FK em cascata: apagar a conta apaga o documento. Fora de `user` pelo motivo
  de `userAccess`.
- **RLS por pessoa:** `user_id = app_user_id()`, `ENABLE` e `FORCE`, sem política de DELETE. Sem `app.user_id` a conexão não vê
  nada, e nem o responsável lê o documento de outro membro. `ou_worker` não tem grant nenhum. `withHousehold` já aplica o
  `app.user_id`, então só a própria linha aparece ali também.
- **Cifrado com AES-256-GCM**, com conta e campo como dado autenticado: copiar o valor para outra linha não abre. A razão
  social também é cifrada, porque a de MEI costuma trazer o CPF. Formato `v1.<kid>.<iv>.<tag>.<dado>`, com IV de 12 bytes e
  etiqueta de 16 conferidos ao abrir: etiqueta curta não passa.
- **Chave: `DOCUMENT_ENCRYPTION_KEY`, só no `ou3-web`**, 32 bytes em base64 padrão, conferidos pelo formato. O worker e
  `packages/ai` não a recebem. A chave de cifra, a do hash e a impressão digital saem dela por HKDF, cada uma com o seu rótulo.
- **Chave trocada não desliga a duplicidade calada.** `kid` é a impressão digital da chave. Havendo documento com outro `kid`,
  os hashes antigos não casam mais: `identity_key_mismatch` acusa, documento novo não entra, e `/admin` avisa. Quem mora fora e
  quem já está dentro seguem.
- **Hash de duplicidade: HMAC-SHA256, e não hash com sal comum.** O sal precisa ser secreto e igual para todos: CPF tem cerca
  de 10⁹ valores, e sal público cairia em força bruta em minutos. Sal por linha não acharia a duplicidade.
- **Só o mascarado sai para as telas** (`***.456.789-**`, `**.ABC.345/01DE-**`). O documento não muda pela tela: correção é
  pelo suporte, para ninguém trocar por um CPF de outra pessoa depois de cadastrado.
- **Fora da auditoria da família**, como o idioma: é da pessoa, não da família.

### Sem a chave: recusa

Sem a variável, quem mora no Brasil **não consegue se cadastrar**: nada é aceito para depois ser perdido, nem guardado em
texto puro. A pessoa lê que nada foi salvo e tenta depois. Quem mora fora, quem já tem conta e todo o resto seguem normais, e
`/admin` e `/admin/sistema` avisam. A alternativa, criar a conta sem documento e pedir de novo, fingiria guardar o que foi
digitado e deixaria o cadastro passar sem checar duplicidade, que é o que o pedido quer evitar.

### Duplicidade

- **Pessoa física: um CPF, uma conta. Pessoa jurídica: um CNPJ, uma conta.** O índice único do CPF é parcial, só para
  `person_type = 'pf'`, e vale acima da RLS, então dois cadastros ao mesmo tempo também caem.
- **O CPF do responsável não é único.** Decisão do fundador: a mesma pessoa pode ter a conta PF e responder por várias
  empresas, cada uma com a sua conta e o seu CNPJ. O CPF de responsável não reserva a conta PF de ninguém, nem o contrário.
- **Sócio convidado é pessoa**, com `person_type = 'pf'`, e segue a regra de PF. Quem já tem conta com o e-mail convidado entra
  pelo login e aceita, sem informar nada de novo e sem passar pelo índice. Quem tenta criar outra conta PF com o mesmo CPF é
  recusado, e a mensagem do cadastro lembra de entrar pela conta que já existir.
- **Casal:** cada um com a sua conta e o seu CPF, na mesma família, pelo convite. O limite é por conta, não por família, e
  uma conta pode estar em mais de uma família.
- **A recusa vem antes da conta (migração 0037).** A RLS esconde as outras linhas e a FK não deixa gravar antes de a conta
  existir, então `reserve_identity_document`, `SECURITY DEFINER`, recebe só o hash e responde sim ou não, ainda em
  `create.before`. Recusado, não há conta, cookie de sessão nem e-mail. A reserva dura 2 minutos: cobre dois cadastros ao mesmo
  tempo e some sozinha se o cadastro morrer no meio. PF disputa o CPF; PJ, o CNPJ. O índice único continua como última barreira.
- **Mensagem neutra**, a mesma de quem tenta trocar o documento, sem dizer que ele existe.
- **Ainda é uma recusa, então há limite.** 20 cadastros por hora por IP e 5 tentativas por hora por conta, somando
  `/app/completar` e o aceite de convite.
- **IP confiável.** O cliente escreve o que quiser em `x-forwarded-for`, e cada proxy só acrescenta no fim. Por isso vale a
  posição `TRUSTED_PROXY_HOPS` contada da direita, com padrão 1, o proxy do Dokploy: não há Cloudflare na frente. O limite de
  pedidos do Better Auth lê o IP antes de qualquer plugin, então `getAuth().handler` reescreve o cabeçalho na entrada.
- **Teto global.** Limite por IP segura um autor; vários IPs passam por ele. Com 30 recusas na hora, somando todo mundo, quem
  já foi recusado, por IP ou por conta, deixa de consultar o documento até a hora virar, e sem consulta não aprende mais nada.
  Quem nunca foi recusado segue normal, e quem mora fora nem consulta. `/admin` avisa. Fica na memória da web, que é um
  processo só: reiniciar zera.
- **Convite.** Quem chega por convite é pessoa no servidor, não só na tela: `parseInviteeIdentity` ignora tipo, CNPJ e razão
  social que vierem no pedido, e o cadastro leva o id do convite até o hook. No aceite, destinatário, status e validade são
  conferidos antes de tocar no documento, e a manutenção recusa tudo.

### Tipo da conta

- **Conta PF tem família; conta PJ tem sócios.** `household.account_type`, `pf` por padrão. Em `household`, fora da RLS,
  porque o convite e o e-mail precisam dele antes de a pessoa entrar, e declarado em `householdAccess`, não em `household`,
  pelo motivo de sempre: o Better Auth lê todas as colunas declaradas.
- **Quem define:** quem se cadastra como empresa cria conta PJ, ao criar o espaço. Responsável que informa empresa em
  `/app/completar` torna a conta PJ. Não volta sozinho para PF.
- **Texto por catálogo, não por tela.** `apps/web/messages/empresa/{pt-BR,en,es}.json` traz, por caminho, as mesmas chaves do
  catálogo com o texto de empresa. `messagesFor(locale, currency, accountType)` aplica por cima, como a marca da moeda (ADR-0020):
  nenhuma tela pergunta o tipo para escolher texto. Vale para menu, tela de pessoas, convites e e-mail, Configurações, dicas de
  erro e os textos dos agentes por chave. Sem sessão, ou sem família ativa e com documento PJ, o tipo vem da pessoa; no convite,
  do convite.
- **O que existe por tipo: `accountFeatures`**, em `packages/domain`. A tela pergunta o recurso: parentesco, casamento,
  dependentes de IR, participação. É a única pergunta sobre o tipo fora do catálogo.
- **Sócio é pessoa com CPF próprio.** Quem aceita convite de conta PJ informa o próprio CPF: no cadastro, ou no aceite, se a conta
  ainda não tiver documento. Ninguém digita o CPF do outro. Em convite, o cadastro é sempre de pessoa, sem a opção de empresa.
- **Sócio que pode alterar vira pessoa da empresa.** Exceção ao "sem link na `people`" do ADR-0011, só em conta PJ: entra em
  `people` com `relation = 'outro'`, porque trocar a CHECK de `relation` não é aditivo. Quem só lê, como um contador, fica em
  "Quem acessa".
- **Participação opcional**, em `people.ownership_percent`, de 0 a 100, só informativa. Nada divide valores por ela, e a soma não
  precisa dar 100.
- **Assistente.** `COMPANY_NOTE` vai em `turnContext`, nunca em `SYSTEM_PROMPT`, que é o prefixo do cache: fale em empresa e
  sócios. Rótulos como "titular" continuam nas ferramentas, e a nota diz o que eles significam.

### Inteligência artificial

O modelo nunca recebe o documento da conta. Nada em `packages/ai` lê `user_identity` nem conhece a chave, e um teste procura.

CPF e CNPJ digitados ou vindos de extrato são outra história: chegam com barra, travessão, espaço, caractere invisível, dígito de
outro alfabeto, colados em letra. `findDocuments`, em `packages/domain`, não olha a pontuação: anda por uma cópia só com letras e
dígitos e confere o dígito verificador de cada janela de 11 e de 14 posições. Quem evita falso positivo são as fronteiras: a janela
não começa nem termina no meio de uma sequência de dígitos, não cruza valor em dinheiro, data nem UUID, e o CNPJ com letra não vale
dentro de código longo. O filtro do assistente e a barreira da Ops API usam a mesma busca. `scrubDeep` também trata string com sinal,
número puro e chave de objeto.

### Exportação e painel

- **Exportação:** bloco `identificacao`, só de quem baixou, mascarado e com aviso. Os números da razão social saem como `*`.
- **Painel:** mostra só se tem documento e o tipo. O completo sai por `adminRevealIdentity`, com o mesmo critério de nome e
  e-mail, registrado na mesma transação, e a web abre. A web é quem tem a chave; o `ou_admin` só enxerga o cifrado. `/admin` em si
  continua em português e fala em família: mostra o tipo da conta no detalhe.

### Política de Privacidade

Versão `2026-11-01.7`, sem re-aceite forçado. Lista CPF, CNPJ, razão social e sócios, a finalidade (identificar o titular,
emitir nota fiscal e prevenir fraude) e a base legal, execução de contrato (art. 7º, V), **a confirmar pelo advogado**, junto com
o CPF de quem é responsável por uma empresa, que é dado do representante e não da parte do contrato. Cita também o parágrafo de
IA dos relatórios, sob o mesmo aceite das dicas e categorias.

## Ainda falta para atender PJ de verdade

Fora desta etapa: contabilidade, plano de contas e DRE; separação de patrimônio entre sócios e entre sócio e empresa; pró-labore
e distribuição de lucros; nota fiscal emitida e recebida; impostos de empresa, como Simples, IRPJ, CSLL, PIS e Cofins; conciliação
bancária de conta PJ; consulta do CNPJ na Receita, para confirmar razão social e situação; mais de um CNPJ na mesma conta; trocar o
responsável. As telas de aposentadoria, viagens e metas continuam as de pessoa.

## Riscos aceitos

- **Várias contas PJ por pessoa.** Basta um CNPJ válido novo, e os dígitos não provam que a empresa existe. Quem quiser mais de um
  período de teste consegue. A assinatura e a consulta do CNPJ na Receita fecham isso depois.
- **Sócio com outro e-mail.** Convite vale por e-mail. Quem já tem conta PF com outro e-mail é recusado ao criar a segunda e precisa
  pedir o convite no e-mail da conta.
- **Recusa ainda é sinal.** Quem tenta um CPF alheio percebe a recusa, mesmo neutra. Os limites e o teto encarecem isso, mas quem
  tem muitos IPs ainda faz uma consulta por IP.
- **Busca em texto livre não é perfeita.** Sequência que parece documento e fecha o dígito, como um telefone, vira `[documento]`
  (cerca de 1 em 100). Valor de R$ 100 milhões ou mais escrito igual a um CPF válido também. Documento que cruza valor ou data, ou
  separado por mais de 3 caracteres, passa. CPF com máscara exata é trocado mesmo com dígito errado.
- **CPF válido de outra pessoa passa.** Validamos dígitos, não titularidade. O dono de verdade é recusado e precisa do suporte.
- **`Outro país` dispensa o documento** para quem marcar, more onde morar. A assinatura decide o que fazer com isso.
- **Perder a chave perde os documentos**, e trocá-la pede recifrar tudo, incluindo os hashes. Enquanto isso, cadastro com documento
  fica recusado. O valor cifrado tem versão e `kid` para a troca ser possível, mas a rotina de recifrar ainda não existe.
- **Reserva depende do dono ser superusuário.** As funções `SECURITY DEFINER` passam pela RLS de `user_identity` porque o dono do banco
  é superusuário (ADR-0002). Dono sem esse poder faria a função enxergar nada, e sobraria só o índice único.
- **Cópias de segurança** guardam o cifrado por até 30 dias depois de apagar a conta.
- **Texto antigo dos agentes:** linha sem chave fica no texto gravado, em português, e pode dizer família numa conta que virou PJ.
- **Uma consulta a mais por requisição:** o tipo da conta, além da moeda.
