import type { Metadata } from "next";

export const metadata: Metadata = { title: "Política de Privacidade" };

export default function PrivacyPage() {
  return (
    <>
      <h1>Política de Privacidade</h1>
      <p>
        Esta política explica quais dados o OrganizeUp guarda, por que guarda e como você controla
        esses dados, conforme a Lei Geral de Proteção de Dados (LGPD).
      </p>

      <h2>Quais dados guardamos</h2>
      <ul>
        <li>
          <strong>Conta:</strong> nome, e-mail, idioma escolhido e senha, guardada de forma que não
          pode ser lida.
        </li>
        <li>
          <strong>Identificação:</strong> se você mora no Brasil, o seu CPF e, em cadastro de pessoa
          jurídica, também o CNPJ e a razão social. Esses dados ficam cifrados no banco de dados, só
          aparecem mascarados e não são lidos pelos assistentes. Quem mora em outro país não informa
          documento.
        </li>
        <li>
          <strong>Empresa:</strong> em conta de pessoa jurídica, os sócios e, se você informar, o
          percentual de participação de cada um. Cada sócio informa o próprio CPF ao aceitar o
          convite. O percentual é só informativo.
        </li>
        <li>
          <strong>Família:</strong> nomes, relação entre as pessoas, mês e ano de nascimento, cidade
          e, se você quiser informar, dia, mês e ano do casamento.
        </li>
        <li>
          <strong>Trabalho e previdência dos adultos do plano:</strong> situação de trabalho, se
          contribui para o INSS, benefício mensal esperado e idade em que pretende parar.
        </li>
        <li>
          <strong>Finanças:</strong> o que você informa ou importa, como contas, lançamentos,
          cartões, dívidas, renda, reserva, bens, investimentos, proventos, metas, planos de
          aposentadoria, viagens e eventos do calendário.
        </li>
        <li>
          <strong>Arquivos de dívidas:</strong> os contratos, faturas, extratos e planilhas que você
          anexar, com o nome do arquivo e o que foi lido nele. Podem trazer nome, CPF, endereço e
          número de contrato. Ficam no nosso banco de dados, separados por família, até 50 MB por
          família.
        </li>
        <li>
          <strong>Arquivos importados:</strong> os arquivos que você enviar em Importar arquivos, de
          qualquer tipo, com o nome do arquivo, o que foi lido em cada um e o que estava para
          aprovar. Podem trazer nome, CPF, endereço e dados de outras pessoas, como fiadores,
          dependentes e quem aparece em um contrato. Ficam no nosso banco de dados, separados por
          família, até 100 MB por família.
        </li>
        <li>
          <strong>Gerado pelo sistema:</strong> plano de cada meta, projeção de aposentadoria,
          destinos de viagem sugeridos, plano para sair das dívidas e os relatórios e sugestões do
          assistente.
        </li>
        <li>
          <strong>Assistente:</strong> se a família ativar, as conversas de cada pessoa, que só ela
          vê, as dicas preparadas para a família, as anotações que você pedir para ele lembrar e a
          quantidade de uso por dia, sem nenhum texto.
        </li>
        <li>
          <strong>Uso:</strong> endereço IP e navegador da sessão, e um registro das ações feitas na
          família.
        </li>
      </ul>

      <h2>Para que usamos</h2>
      <ul>
        <li>
          Prestar o serviço que você contratou ao criar a conta, incluindo montar os planos de
          aposentadoria, metas e viagens (LGPD, art. 7º, V).
        </li>
        <li>
          Identificar quem é titular da conta, emitir nota fiscal e prevenir fraude, com CPF, CNPJ e
          razão social. Nós os tratamos para executar o contrato que você faz conosco (LGPD, art.
          7º, V).
        </li>
        <li>
          Enviar os e-mails do serviço: confirmar seu e-mail, trocar a senha, avisar que a senha
          mudou e entregar convites para a família (art. 7º, V).
        </li>
        <li>
          Enviar lembretes por e-mail a cada pessoa com acesso à família: o que vence, o que entra
          (renda e proventos), os gastos novos e, uma vez por mês, o resumo do plano de
          aposentadoria. Fazem parte do serviço (art. 7º, V), e cada pessoa escolhe o que recebe, ou
          desliga tudo, em Notificações.
        </li>
        <li>
          Responder às suas perguntas no assistente com inteligência artificial, se a família
          autorizar. A base é o seu consentimento (art. 7º, I), que pode ser retirado a qualquer
          momento em Configurações.
        </li>
        <li>
          Ler os arquivos de dívidas com inteligência artificial, se a família autorizar na própria
          tela de importação. A base também é o seu consentimento (art. 7º, I).
        </li>
        <li>
          Guardar e ler os arquivos que você enviar em Importar arquivos, para mostrar o que achamos
          neles e gravar o que você aprovar. As regras sem inteligência artificial fazem parte do
          serviço que você contratou (art. 7º, V). A leitura com inteligência artificial depende do
          seu consentimento (art. 7º, I).
        </li>
        <li>Manter o sistema seguro e prevenir fraude e acesso indevido (art. 7º, IX).</li>
        <li>Cumprir obrigações legais (art. 7º, II).</li>
      </ul>
      <p>
        Não vendemos seus dados, não mostramos anúncios e não usamos seus dados financeiros para
        publicidade.
      </p>

      <h2>Assistentes automáticos</h2>
      <p>
        Todos os dias, assistentes automáticos revisam categorias, investimentos, dívidas,
        aposentadoria, viagens e metas da sua família e deixam sugestões para você decidir. Eles
        seguem regras fixas, rodam dentro do banco de dados da sua família e nada sai para
        terceiros. A única exceção é a revisão de categorias com inteligência artificial, descrita
        abaixo, que só acontece se a família autorizou o assistente.
      </p>
      <p>
        O que você informou só muda com o seu aceite. O que o sistema calcula, como o plano de uma
        meta, é refeito todo dia. A categoria é a exceção: um assistente muda sozinho, sem pedir
        aceite, o lançamento que ficou para revisar ou em uma categoria genérica, como Outras
        despesas, mesmo que você mesmo o tenha colocado lá, e junta categorias quase iguais. Cada
        mudança aparece em Notificações, com o antes e o depois, e você pode desfazer. Lançamento
        que você colocou em uma categoria específica não muda sozinho.
      </p>

      <h2>Assistente com inteligência artificial</h2>
      <p>
        O assistente de conversa é opcional e só funciona depois que um adulto da família autoriza.
        Sem essa autorização, nada é enviado.
      </p>
      <ul>
        <li>
          <strong>O que vai:</strong> o que você escreve e, quando a pergunta precisa, dados das
          suas finanças, como lançamentos e suas descrições, categorias, renda, reserva, dívidas,
          investimentos, proventos, metas, viagens e calendário. As anotações da família também vão
          em cada conversa. De madrugada, os mesmos dados são usados para preparar as dicas que
          aparecem em cada tela, sem que ninguém pergunte. Também de madrugada vão as descrições dos
          lançamentos sem categoria definida, com quantidade e valor médio, e os nomes das suas
          categorias, para classificar esses lançamentos. Os relatórios da família podem trazer um
          parágrafo escrito com inteligência artificial, a partir desses mesmos dados e sob o mesmo
          aceite das dicas e das categorias.
        </li>
        <li>
          <strong>O que não vai:</strong> nomes, e-mails, CPF, CNPJ, razão social e senhas. O
          documento informado no cadastro nunca é enviado. As pessoas aparecem como titular,
          cônjuge, filho 1, e os nomes conhecidos da família são trocados também nas descrições. CPF
          e CNPJ que apareçam em uma descrição são trocados por [documento]. Uma descrição de
          extrato ainda pode conter outros dados de terceiros, como o nome de um estabelecimento ou
          de quem recebeu um pagamento.
        </li>
        <li>
          <strong>Para quem:</strong> a Anthropic, PBC, empresa dos Estados Unidos que opera o
          modelo de inteligência artificial e atua como nossa operadora. Ela usa esses dados para
          gerar a resposta e não os usa para treinar modelos, conforme os termos comerciais dela.
          Pelas regras publicadas por ela, apaga esses dados em até 30 dias; o que os sistemas de
          segurança dela marcarem como violação das regras de uso pode ficar guardado por até 2
          anos.
        </li>
        <li>
          <strong>Transferência internacional:</strong> como a Anthropic trata os dados nos Estados
          Unidos, há transferência internacional de dados (LGPD, art. 33), feita com o seu
          consentimento específico.
        </li>
        <li>
          <strong>Conversas:</strong> ficam guardadas na sua conta e só você as vê. Você pode apagar
          cada uma quando quiser, e elas somem ao apagar a conta.
        </li>
        <li>
          <strong>Memórias:</strong> quando você pede na conversa, o assistente anota uma
          preferência, um objetivo ou um fato sobre a família, para não perguntar de novo. As
          anotações não guardam valores em dinheiro, e os nomes conhecidos da família são trocados
          antes de gravar. Quem é da família vê tudo em Configurações, no bloco O que o assistente
          sabe, e os adultos podem apagar uma por uma ou todas de uma vez, e aí elas somem de
          verdade, com as versões antigas. Desligar o assistente não apaga as anotações, mas elas
          deixam de ser enviadas. Elas somem ao apagar a família e entram no arquivo de dados que o
          responsável baixa.
        </li>
        <li>
          <strong>Limites:</strong> o assistente não acessa bancos, não move dinheiro e não faz
          recomendação individual de investimento.
        </li>
      </ul>
      <p>
        Respostas de inteligência artificial podem conter erros. Confira antes de decidir. Para
        retirar a autorização, use Configurações: nada mais é enviado a partir daí.
      </p>

      <h2>Leitura de arquivos de dívidas</h2>
      <p>
        Ler um arquivo é opcional e pede duas autorizações: o assistente ativo e o aceite na tela de
        importação. Sem elas, o arquivo fica guardado e nada é enviado.
      </p>
      <ul>
        <li>
          <strong>O que vai:</strong> o arquivo inteiro. Diferente da conversa, um PDF ou uma foto
          vai como está, com o nome, o CPF, o endereço e os números que estiverem nele. Em CSV e
          Excel, trocamos antes os nomes conhecidos da família, o e-mail e o CPF. O nome do arquivo
          não vai.
        </li>
        <li>
          <strong>Para quem:</strong> a Anthropic, PBC, nas mesmas condições descritas acima, com
          transferência internacional para os Estados Unidos (LGPD, art. 33) feita com o seu
          consentimento específico.
        </li>
        <li>
          <strong>Para quê:</strong> só para preencher a conferência: credor, saldo, juros,
          parcelas, vencimento, sistema de amortização e custo efetivo total. Nada vira dívida até
          você confirmar, e um número lido nunca entra em cálculo antes disso.
        </li>
        <li>
          <strong>Apagar:</strong> você apaga cada arquivo na tela de Dívidas, e apagar a dívida ou
          a família leva os arquivos. Desligar o assistente retira também este aceite.
        </li>
        <li>
          <strong>Exportação:</strong> o arquivo de dados da família traz nome, tipo, tamanho e data
          de cada anexo, sem o conteúdo. Para ter o documento, baixe na tela de Dívidas.
        </li>
      </ul>

      <h2>Importar arquivos</h2>
      <p>
        Nesta tela, ao contrário do importador de extrato, o arquivo vai para o nosso servidor, para
        ser lido mesmo depois que você sair da tela. Primeiro nossas regras tentam entender o
        arquivo, sem inteligência artificial e sem nada sair para terceiros. Só o que elas não
        entenderem pode ir ao modelo, e só com o assistente ativo e o aceite na própria tela.
      </p>
      <ul>
        <li>
          <strong>O que vai:</strong> o texto do arquivo, depois de trocarmos CPF, CNPJ, e-mail e os
          nomes conhecidos da família. O texto pode conter dados de outras pessoas, como fiadores,
          dependentes, vendedores e testemunhas, porque só conhecemos os nomes da sua família. O
          nome do arquivo não vai.
        </li>
        <li>
          <strong>Digitalização e foto:</strong> não têm texto para trocar, então vão como estão,
          com o nome, o CPF, o endereço e tudo o que estiver visível, seus e de outras pessoas.
          Mande só o que você pode compartilhar.
        </li>
        <li>
          <strong>Para quem:</strong> a Anthropic, PBC, nas mesmas condições descritas acima, com
          transferência internacional para os Estados Unidos (LGPD, art. 33) feita com o seu
          consentimento específico. Este aceite é mais amplo que o da leitura de dívidas e precisa
          ser dado de novo.
        </li>
        <li>
          <strong>Para quê:</strong> só para dizer o que é o arquivo e propor onde cada item entra.
          Nada vai para o cadastro antes da sua aprovação, e dado de outra pessoa não vira cadastro
          de pessoa. Os campos dos documentos que você aprovar, sem CPF nem CNPJ, ficam disponíveis
          para o assistente; o arquivo inteiro, não.
        </li>
        <li>
          <strong>Por quanto tempo:</strong> envio em que nada foi aprovado é apagado em 30 dias.
          Envio com algo aprovado fica guardado até você apagar. Apagar o envio leva os arquivos e o
          que foi lido, e não mexe no que você já aprovou. O contrato que virou dívida também fica
          nos anexos da dívida: para tirá-lo de lá, apague o anexo na tela de Dívidas. Apagar a
          família apaga tudo.
        </li>
        <li>
          <strong>Exportação:</strong> o arquivo de dados da família traz o que foi lido e as
          propostas, com nome, tipo e tamanho de cada arquivo, sem o conteúdo. Para ter o documento,
          baixe na tela de Importar arquivos.
        </li>
      </ul>

      <h2>Quem vê seus dados</h2>
      <p>
        Dentro do sistema, cada família tem seus dados separados, e só quem foi convidado para ela
        tem acesso. A equipe automática que faz a manutenção do sistema não tem acesso aos dados das
        famílias.
      </p>
      <p>
        Para dar suporte, a administração do serviço vê o nome da família, as datas de criação e de
        último acesso, as pessoas com acesso pelo papel de cada uma e quais áreas do sistema a
        família usa, sem nenhum valor. Na lista de contas, vê o nome e o e-mail de cada pessoa
        cadastrada, para saber com quem está falando; cada acesso a essa lista fica registrado. Do
        documento, o painel mostra só se existe e se é de pessoa física ou jurídica; o documento
        completo só aparece por pedido do responsável pelo suporte, e esse pedido fica registrado.
        Dados financeiros não aparecem nesse painel. A administração também pode suspender o acesso
        de uma família, bloquear uma conta ou excluí-las, por exemplo em caso de abuso ou a pedido;
        essas ações ficam registradas.
      </p>
      <p>Usamos fornecedores para funcionar:</p>
      <ul>
        <li>Empresa de servidores, onde o sistema e o banco de dados ficam hospedados.</li>
        <li>
          Cloudflare, que guarda as cópias de segurança e pode intermediar o acesso ao site. Esses
          dados podem ser tratados fora do Brasil.
        </li>
        <li>
          Brevo, que entrega os e-mails do serviço. Ela recebe o endereço de e-mail, o nome e o
          texto da mensagem, que nos convites traz o nome de quem convidou e o da família. Nos
          lembretes, o texto traz também o nome da família, descrições de contas e gastos, datas e
          valores; quem desliga os lembretes em Notificações deixa de ter esses dados enviados. Nos
          demais e-mails não vai dado financeiro. Esses dados podem ser tratados fora do Brasil.
        </li>
        <li>
          Anthropic, que opera o assistente com inteligência artificial, só para as famílias que o
          ativarem. Os dados são tratados nos Estados Unidos.
        </li>
      </ul>

      <h2>Cookies</h2>
      <p>
        Usamos apenas o cookie necessário para manter você conectado, um cookie que lembra, até o
        fim do dia, que você fechou um aviso, e um cookie que guarda por um ano o idioma que você
        escolheu. Não usamos cookies de publicidade.
      </p>

      <h2>Por quanto tempo</h2>
      <p>
        Guardamos os dados enquanto a conta existir. Ao apagar a conta, os dados saem do sistema na
        hora, mas continuam nas cópias de segurança por até 30 dias, até serem substituídas.
      </p>
      <p>
        O documento segue a mesma regra: apagar a conta apaga o CPF, o CNPJ e a razão social. No
        arquivo de dados baixado em Configurações, ele sai mascarado, só o de quem baixou.
      </p>
      <p>
        Se você apagar a conta sendo o responsável por uma família só sua, a família e todos os
        dados dela são apagados. Se a família tiver outras pessoas, remova o acesso delas antes. Se
        você apenas participa de uma família, seu acesso acaba, e os dados que você lançou continuam
        com ela.
      </p>

      <h2>Seus direitos</h2>
      <p>
        Você pode confirmar se tratamos seus dados, acessá-los, corrigi-los, levá-los para outro
        serviço, pedir que sejam apagados e obter informação sobre com quem são compartilhados
        (LGPD, art. 18).
      </p>
      <ul>
        <li>Corrigir: nas telas do próprio sistema. O documento, pelo suporte.</li>
        <li>Baixar os dados da família: Configurações, opção disponível para o responsável.</li>
        <li>Apagar as anotações do assistente: Configurações.</li>
        <li>Baixar ou apagar os arquivos de dívidas: tela de Dívidas.</li>
        <li>Baixar ou apagar os arquivos importados: tela de Importar arquivos.</li>
        <li>Apagar a conta: Configurações.</li>
      </ul>
      <p>Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</p>

      <h2>Crianças e adolescentes</h2>
      <p>
        A conta é para maiores de 18 anos. Dados de crianças e adolescentes entram só pelo
        responsável, e pedimos o mínimo: nome, relação e mês e ano de nascimento.
      </p>

      <h2>Segurança</h2>
      <p>
        Usamos conexão cifrada, separação dos dados por família e cópias de segurança diárias em
        armazenamento privado. Nenhum sistema é totalmente seguro. Se houver incidente com risco
        relevante, avisaremos você e a ANPD.
      </p>

      <h2>Mudanças nesta política</h2>
      <p>Se esta política mudar de forma importante, avisaremos no sistema.</p>
    </>
  );
}
