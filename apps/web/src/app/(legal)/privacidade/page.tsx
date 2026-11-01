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
          <strong>Conta:</strong> nome, e-mail e senha, guardada de forma que não pode ser lida.
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
          <strong>Gerado pelo sistema:</strong> plano de cada meta, projeção de aposentadoria,
          destinos de viagem sugeridos e os relatórios e sugestões do assistente.
        </li>
        <li>
          <strong>Assistente:</strong> se a família ativar, as conversas de cada pessoa, que só ela
          vê, e a quantidade de uso por dia, sem nenhum texto.
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
          Enviar os e-mails do serviço: confirmar seu e-mail, trocar a senha, avisar que a senha
          mudou e entregar convites para a família (art. 7º, V).
        </li>
        <li>
          Responder às suas perguntas no assistente com inteligência artificial, se a família
          autorizar. A base é o seu consentimento (art. 7º, I), que pode ser retirado a qualquer
          momento em Configurações.
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
        Todos os dias, assistentes automáticos revisam categorias, investimentos, aposentadoria,
        viagens e metas da sua família e deixam sugestões para você decidir. Eles seguem regras
        fixas, sem inteligência artificial, rodam dentro do banco de dados da sua família e nada sai
        para terceiros.
      </p>
      <p>
        O que você informou só muda com o seu aceite. O que o sistema calcula, como o plano de uma
        meta, é refeito todo dia. Quando um assistente move um lançamento que ficou para revisar, a
        mudança aparece em Sugestões, e você pode desfazer.
      </p>

      <h2>Assistente com inteligência artificial</h2>
      <p>
        O assistente de conversa é opcional e só funciona depois que um adulto da família autoriza.
        Sem essa autorização, nada é enviado.
      </p>
      <ul>
        <li>
          <strong>O que vai:</strong> o que você escreve e, só quando a pergunta precisa, dados das
          suas finanças, como lançamentos e suas descrições, categorias, renda, reserva, dívidas,
          investimentos, proventos, metas, viagens e calendário.
        </li>
        <li>
          <strong>O que não vai:</strong> nomes, e-mails, CPF e senhas. As pessoas aparecem como
          titular, cônjuge, filho 1, e os nomes conhecidos da família são trocados também nas
          descrições. Uma descrição de extrato ainda pode conter outros dados de terceiros, como o
          nome de um estabelecimento ou de quem recebeu um pagamento.
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
          <strong>Limites:</strong> o assistente não acessa bancos, não move dinheiro e não faz
          recomendação individual de investimento.
        </li>
      </ul>
      <p>
        Respostas de inteligência artificial podem conter erros. Confira antes de decidir. Para
        retirar a autorização, use Configurações: nada mais é enviado a partir daí.
      </p>

      <h2>Quem vê seus dados</h2>
      <p>
        Dentro do sistema, cada família tem seus dados separados, e só quem foi convidado para ela
        tem acesso. A equipe automática que faz a manutenção do sistema não tem acesso aos dados das
        famílias.
      </p>
      <p>
        Para dar suporte, a administração do serviço vê o nome da família, as datas de criação e de
        último acesso, as pessoas com acesso pelo papel de cada uma e quais áreas do sistema a
        família usa, sem nenhum valor. Nome e e-mail do responsável só aparecem quando pedidos, e
        cada acesso fica registrado. Dados financeiros não aparecem nesse painel. A administração
        também pode suspender o acesso de uma família, bloquear uma conta ou excluí-las, por exemplo
        em caso de abuso ou a pedido; essas ações ficam registradas.
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
          texto da mensagem, que nos convites traz o nome de quem convidou e o da família. Dados
          financeiros não vão nesses e-mails. Esses dados podem ser tratados fora do Brasil.
        </li>
        <li>
          Anthropic, que opera o assistente com inteligência artificial, só para as famílias que o
          ativarem. Os dados são tratados nos Estados Unidos.
        </li>
      </ul>

      <h2>Cookies</h2>
      <p>
        Usamos apenas o cookie necessário para manter você conectado e um cookie que lembra, até o
        fim do dia, que você fechou um aviso. Não usamos cookies de publicidade.
      </p>

      <h2>Por quanto tempo</h2>
      <p>
        Guardamos os dados enquanto a conta existir. Ao apagar a conta, os dados saem do sistema na
        hora, mas continuam nas cópias de segurança por até 30 dias, até serem substituídas.
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
        <li>Corrigir: nas telas do próprio sistema.</li>
        <li>Baixar os dados da família: Configurações, opção disponível para o responsável.</li>
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
