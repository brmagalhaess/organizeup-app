# Rollback

## Caminho preferido: `git revert`

Reverta o commit problemático e envie para `main` (`git revert <sha>`). O Dokploy reconstrói e publica.
É o caminho que o agente SRE usa.

## Caminho rápido (humano)

Na aba **Deployments** do serviço, use **Rollback** se estiver habilitado em Configure Rollbacks. Sem isso,
use o `git revert` acima.

Se o problema envolveu migração, não remova nem edite a migração: elas são aditivas, então o código
antigo continua compatível com o schema novo.

## Automático

O health check do container (`?probe=live`) reinicia a web quando o processo não responde. Ele não detecta
erro de negócio; por isso confira `/api/health` completo depois de cada deploy.
