# Segurança

## Versões suportadas

A linha estável `1.0.x` recebe correções de segurança e manutenção. Versões alpha e `1.0.0-rc.x` não recebem novas correções após a publicação da versão estável.

## Perímetro da API

- O Engine escuta em `127.0.0.1` por padrão.
- Binding de rede exige `MESTRE_ORC_API_TOKEN` com pelo menos 24 caracteres, salvo desativação explícita de `MESTRE_ORC_REQUIRE_API_TOKEN`.
- O módulo envia o token por `X-Mestre-Orc-Token`; Bearer também é aceito.
- CORS usa allowlist, não curinga.
- Endpoints `/v1` possuem rate limit por IP e rota.
- Respostas JSON recebem `no-store`, CSP restritiva, `nosniff`, `DENY` para frames e `no-referrer`.
- Logs redigem autorização, token, chaves, senhas e passphrases.

A autenticação por token protege o serviço, mas não substitui identidade individual por jogador. Não exponha o Engine diretamente à internet sem TLS, firewall e proxy apropriado.

## Segredos e arquivos locais

Nunca publique:

- `.env`;
- `data/`;
- arquivos `.mobackup`;
- relatórios reais de diagnóstico;
- chaves de provedores;
- tokens da API;
- snapshots de migração.

O gate `npm run release:audit` procura padrões conhecidos de segredo e arquivos proibidos. O SBOM não contém credenciais.

## Provedores de IA e voz

- Chaves ficam somente no Engine.
- Envie apenas o contexto necessário.
- Erros externos são sanitizados.
- O projeto não cria ou clona vozes biométricas.
- Use somente vozes e serviços para os quais exista autorização.
- A saída neural é identificada como voz gerada por IA.

## Documentos e spoilers

- Importe somente arquivos confiáveis.
- O Engine não executa macros ou scripts incorporados.
- O padrão é `REFERENCE_ONLY`.
- Conteúdo `GM_ONLY`, segredos, armadilhas e soluções não entram em saídas para jogadores.
- PDFs digitalizados exigem OCR externo.

## Tutores e automações

- Tutores são consultivos e não alteram fichas ou mundo.
- A IA cria propostas, nunca executa automações diretamente.
- Execução exige GM, aprovação e confirmação separadas.
- A allowlist bloqueia código, macros, ownership, exclusões arbitrárias e caminhos não autorizados.
- Rollback verifica conflitos antes de desfazer.

## Backups e migrações

- Backups usam SHA-256 e podem usar AES-256-GCM com `scrypt`.
- A senha não é armazenada.
- Restauração exige inspeção, token temporário e snapshot prévio.
- Migrações interrompem diante de JSON inválido.
- Verifique `checksums.sha256` antes de instalar uma release.

## Dependências

O lockfile usa o registro público do npm. `fastify` está bloqueado em `5.10.0` e `fast-uri` em `3.1.4`. O gate offline exige `fast-uri >= 3.1.2`. Execute `npm run check` quando o registro npm estiver acessível para incluir `npm audit`.

## Relato responsável

Relate vulnerabilidades de forma privada ao mantenedor, informando versão, impacto e passos mínimos. Não inclua chaves, conteúdo privado da campanha ou dados pessoais desnecessários.
