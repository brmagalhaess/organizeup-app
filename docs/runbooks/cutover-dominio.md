# Troca de domínio: organizeup.com.br

Executar só quando o novo OrganizeUp substituir o sistema antigo (Fase 8). Até lá, `organizeup.com.br`
continua no sistema antigo, em `2.24.94.160`.

## Situação atual

- DNS de `organizeup.com.br` e `www`: Hostinger (`byte.dns-parking.com`, `pixel.dns-parking.com`), apontando
  para `2.24.94.160`. Esse domínio **não** está no Cloudflare; `crowntech.com.br` está.
- Novo sistema: `https://organizeup.home.crowntech.com.br`, servidor `169.58.235.246`.
- O domínio `organizeup.com.br` já está cadastrado no `ou3-web`, sem HTTPS, e não recebe tráfego.

## Passos

1. Faça a migração final de dados e deixe o sistema antigo em somente leitura (Fase 8 do plano-mestre).
2. Reduza o TTL do registro `A` para 300 s um dia antes.
3. Decida onde fica o DNS. Para usar o Cloudflare: adicione a zona lá, copie os registros e troque os
   nameservers na Hostinger. Isso pode levar horas; faça com antecedência e mantenha o `A` em `2.24.94.160`
   até o dia da troca.
4. No dia: aponte `organizeup.com.br` para `169.58.235.246`. Se estiver no Cloudflare, deixe o proxy
   desligado (nuvem cinza) até o certificado sair.
5. Confirme que o DNS novo chegou:
   ```bash
   nslookup organizeup.com.br 1.1.1.1
   ```
6. No Dokploy, em `ou3-web` → Domains, edite `organizeup.com.br`: ligue HTTPS com Let's Encrypt. Faça isso
   só depois do passo 5, senão o certificado falha.
7. Adicione `www.organizeup.com.br` da mesma forma, se o `www` for ser usado.
8. Em `ou3-web` → Environment, troque `BETTER_AUTH_URL=https://organizeup.com.br`, clique em Save e faça o
   Deploy. Sem isso, o login recusa a origem nova.
9. Teste `/api/health`, cadastro e login no domínio novo.
10. Mantenha `organizeup.home.crowntech.com.br` com redirecionamento até confirmar que ninguém o usa.
    Sessões abertas no domínio antigo terminam; os usuários entram de novo.

## Volta atrás

Reaponte o DNS para `2.24.94.160` e restaure `BETTER_AUTH_URL=https://organizeup.home.crowntech.com.br`.
