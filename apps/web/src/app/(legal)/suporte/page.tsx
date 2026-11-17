import type { Metadata } from "next";

export const metadata: Metadata = { title: "Suporte" };

const EMAIL = "suporte@crowntech.com.br";

/** Página pública de contato, usada também como endereço de suporte nas lojas de aplicativos. */
export default function SupportPage() {
  return (
    <>
      <h1>Suporte</h1>
      <p>
        Precisa de ajuda com o OrganizeUp, no site ou no aplicativo? Escreva para{" "}
        <a href={`mailto:${EMAIL}`} className="font-semibold text-brand-700 underline">
          {EMAIL}
        </a>
        . Respondemos em até 2 dias úteis.
      </p>

      <h2>Antes de escrever</h2>
      <ul>
        <li>Esqueceu a senha? Use &quot;Esqueci minha senha&quot; na tela de entrada.</li>
        <li>O cadastro e o plano são feitos pelo site. O aplicativo usa o mesmo e-mail e senha.</li>
        <li>Para apagar a conta e os dados, veja o passo a passo abaixo.</li>
      </ul>

      <h2 id="apagar-conta">Apagar a conta do OrganizeUp</h2>
      <p>Vale para o site e para o aplicativo do OrganizeUp, da CrownTech LTDA. Para apagar:</p>
      <ol className="list-decimal pl-5">
        <li>Entre no site organizeup.crowntech.com.br com o seu e-mail e senha.</li>
        <li>Abra Configurações.</li>
        <li>
          Toque em Apagar conta, digite a sua senha e confirme em Apagar minha conta. Se a família
          tiver outras pessoas, remova o acesso delas em Família antes.
        </li>
      </ol>
      <p>
        No aplicativo, o caminho é Perfil, Apagar minha conta, que abre a mesma tela no site. Se não
        conseguir entrar, peça por e-mail em {EMAIL}, a partir do e-mail da conta.
      </p>
      <p>
        <strong>O que é apagado:</strong> nome, e-mail, senha, documento (CPF ou CNPJ) e, se você
        for o responsável por uma família só sua, a família inteira com contas, lançamentos,
        cartões, metas, arquivos e conversas do assistente.
      </p>
      <p>
        <strong>O que fica:</strong> se a família tiver outras pessoas, os dados que você lançou
        continuam com ela. As cópias de segurança guardam os dados por até 30 dias, até serem
        substituídas. Detalhes na Política de Privacidade.
      </p>

      <h2>Ao escrever</h2>
      <p>
        Conte o que aconteceu, em qual tela e se foi no site, no iPhone ou no Android. Não mande
        senha, código de verificação nem número de cartão: nunca pedimos esses dados.
      </p>
    </>
  );
}
