# Rollback

## Caminho preferido: `git revert`

Reverta o commit problemático e envie para `main` (`git revert <sha>`). O Dokploy reconstrói e publica.
É o caminho que o agente SRE usa.

## Caminho rápido (humano)

Na aba **Deployments** do serviço, use **Rollback** se estiver habilitado em Configure Rollbacks. Sem isso,
use o `git revert` acima.

Se o problema envolveu migração, não remova nem edite a migração: elas são aditivas, então o código
antigo continua compatível com o schema novo.

Para subir o worker **sem** aplicar migração — por exemplo, quando o próprio migrador está falhando e você
precisa das filas de pé — coloque `RUN_MIGRATIONS=false` nas variáveis do `ou3-worker` e faça o deploy. É um
recurso de incidente: tire a variável (ou volte para vazio) no deploy seguinte, senão toda migração nova
deixa de ser aplicada em silêncio e a web passa a ler coluna que não existe. O padrão, sem a variável, é
aplicar as migrações. Quem define variável no Dokploy é o fundador.

## Automático

O health check do container (`?probe=live`) reinicia a web quando o processo não responde. Ele não detecta
erro de negócio; por isso confira `/api/health` completo depois de cada deploy.
