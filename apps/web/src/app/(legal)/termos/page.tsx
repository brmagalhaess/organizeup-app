import type { Metadata } from "next";

export const metadata: Metadata = { title: "Termos de Uso" };

export default function TermsPage() {
  return (
    <>
      <h1>Termos de Uso</h1>
      <p>
        Estes termos valem para quem usa o OrganizeUp. Ao criar uma conta, você concorda com eles e
        com a Política de Privacidade.
      </p>

      <h2>O que é o OrganizeUp</h2>
      <p>
        É uma ferramenta para organizar as finanças da família: contas, lançamentos, cartões,
        dívidas, renda, reserva, patrimônio, investimentos, metas, aposentadoria, viagens e
        calendário. Não é banco, corretora nem instituição de pagamento. Não movimenta dinheiro e
        não acessa sua conta bancária.
      </p>

      <h2>Não é recomendação financeira</h2>
      <p>
        Cálculos, simulações, previsões e sugestões do assistente são estimativas feitas a partir do
        que você informa, e podem estar diferentes do valor real. Eles não são recomendação de
        investimento nem orientação jurídica, contábil ou tributária. As decisões são suas. Confira
        valores importantes na fonte oficial.
      </p>

      <h2>Sua conta</h2>
      <ul>
        <li>Você precisa ter 18 anos ou mais para criar uma conta.</li>
        <li>Informe dados verdadeiros e guarde sua senha. Ela é pessoal.</li>
        <li>Você responde pelo que for feito com a sua conta.</li>
      </ul>

      <h2>Família e convites</h2>
      <p>
        Cada família tem um responsável, que convida outras pessoas e decide o que cada uma pode
        fazer. Quem acessa uma família vê os dados dela. Só convide quem pode ver essas informações,
        e só cadastre dados de outras pessoas se tiver o direito de fazer isso. Dados de crianças
        devem ser informados por quem responde por elas.
      </p>

      <h2>Uso permitido</h2>
      <p>
        Não use o serviço para fraude ou atividade ilegal, nem tente acessar dados de outras
        famílias ou prejudicar o funcionamento do sistema. Podemos suspender a conta que fizer isso.
      </p>

      <h2>Disponibilidade</h2>
      <p>
        O serviço está em evolução. Telas e funções podem mudar, e podem ocorrer interrupções.
        Fazemos cópias de segurança, mas recomendamos baixar seus dados de vez em quando, em
        Configurações.
      </p>

      <h2>Preço</h2>
      <p>Qualquer cobrança será informada antes, e você poderá decidir se continua usando.</p>

      <h2>Encerramento</h2>
      <p>
        Você pode apagar sua conta quando quiser, em Configurações. O que acontece com os dados está
        explicado na Política de Privacidade.
      </p>

      <h2>Mudanças nestes termos</h2>
      <p>
        Se estes termos mudarem de forma importante, avisaremos no sistema antes de a mudança valer.
      </p>

      <h2>Lei aplicável</h2>
      <p>
        Vale a lei brasileira, incluindo o Código de Defesa do Consumidor. Eventuais disputas podem
        ser levadas ao foro do seu domicílio.
      </p>
    </>
  );
}
