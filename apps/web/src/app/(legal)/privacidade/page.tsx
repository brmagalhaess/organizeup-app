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
          <strong>Família:</strong> nomes, relação entre as pessoas, mês e ano de nascimento,
          cidade.
        </li>
        <li>
          <strong>Finanças:</strong> o que você informa ou importa, como contas, lançamentos,
          cartões, dívidas, renda, reserva, bens e eventos do calendário.
        </li>
        <li>
          <strong>Uso:</strong> endereço IP e navegador da sessão, e um registro das ações feitas na
          família.
        </li>
      </ul>

      <h2>Para que usamos</h2>
      <ul>
        <li>Prestar o serviço que você contratou ao criar a conta (LGPD, art. 7º, V).</li>
        <li>Manter o sistema seguro e prevenir fraude e acesso indevido (art. 7º, IX).</li>
        <li>Cumprir obrigações legais (art. 7º, II).</li>
      </ul>
      <p>
        Não vendemos seus dados, não mostramos anúncios e não usamos seus dados financeiros para
        publicidade.
      </p>

      <h2>Quem vê seus dados</h2>
      <p>
        Dentro do sistema, cada família tem seus dados separados, e só quem foi convidado para ela
        tem acesso. Os agentes automáticos que cuidam do sistema não têm acesso aos dados das
        famílias.
      </p>
      <p>Usamos fornecedores para funcionar:</p>
      <ul>
        <li>Empresa de servidores, onde o sistema e o banco de dados ficam hospedados.</li>
        <li>
          Cloudflare, que guarda as cópias de segurança e pode intermediar o acesso ao site. Esses
          dados podem ser tratados fora do Brasil.
        </li>
      </ul>
      <p>
        Hoje o sistema não envia seus dados para serviços de inteligência artificial. Se isso mudar,
        esta política será atualizada e você será avisado antes.
      </p>

      <h2>Cookies</h2>
      <p>
        Usamos apenas o cookie necessário para manter você conectado. Não usamos cookies de
        publicidade.
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
