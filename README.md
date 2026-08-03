# Mestre Orc Engine

**Versão:** `1.0.0-rc.1`
**Compatibilidade:** Node.js 20–24 · Foundry VTT 13

Mestre Orc é um Engine modular de apoio a sessões de RPG no Foundry VTT. Ele combina narração cinematográfica, entrada e saída por voz, rodadas fora de combate, Combat Tracker, memória persistente, biblioteca de aventuras, criação assistida, mapas, tutores, automações aprovadas, diagnóstico, backup e atualização segura.

> Esta é uma **Release Candidate**. A suíte automatizada cobre Engine, integração, sessão e carga. A validação visual e funcional em uma instalação real do Foundry permanece obrigatória antes da versão estável.

## Principais recursos

- Narração de entrada em salas baseada em Journal/read-aloud, visão do token e contexto normalizado.
- Uma ação por personagem e resolução consolidada de rodadas fora de combate.
- Integração com Combat Tracker, ações, bônus, movimento, reação e resumos de rodada.
- Reconhecimento de voz no navegador e TTS local ou neural.
- Fallback entre Groq, OpenAI, Anthropic e endpoints OpenAI-compatible.
- Memória de fatos, NPCs, relações, missões, itens e estado do mundo.
- Importação semântica de TXT, Markdown, HTML, DOCX e PDF textual com proteção contra spoilers.
- Forja persistente de aventuras, NPCs e dungeons com bloqueio de repetição.
- Mapas vetoriais e criação assistida de Scenes, paredes, portas, luzes, Journals e Notes.
- Tutor de Ficha e Tutor de Mestre, ambos consultivos.
- Automações em fila com aprovação, execução auditável e reversão segura.
- Backup `.mobackup`, criptografia opcional, migrações e rollback.
- Central Mestre Orc unificada e Central de Diagnóstico.

## Início rápido

### Windows

1. Baixe e extraia `mestre-orc-windows-bundle-1.0.0-rc.1.zip`.
2. Abra o PowerShell na pasta `windows`.
3. Execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-mestre-orc.ps1
```

4. Revise `%LOCALAPPDATA%\MestreOrc\engine\.env`.
5. Inicie a API com `%LOCALAPPDATA%\MestreOrc\start-mestre-orc.ps1`.
6. Ative o módulo **Mestre Orc** no mundo do Foundry.

### Instalação manual

```bash
npm ci --omit=dev --ignore-scripts
cp .env.example .env
npm run migrate:apply
npm start
```

Copie o ZIP do módulo para `<FoundryData>/modules/mestre-orc`.

## Segurança da API

O RC usa `127.0.0.1` por padrão. Para expor o Engine na rede, configure um token forte:

```env
HOST=0.0.0.0
MESTRE_ORC_API_TOKEN=gere-um-token-com-ao-menos-24-caracteres
MESTRE_ORC_REQUIRE_API_TOKEN=true
CORS_ALLOWED_ORIGINS=https://seu-foundry.exemplo
```

No Foundry, configure o mesmo endereço e token nas opções do módulo. O token do módulo é armazenado apenas no navegador atual.

## Validação

```bash
npm test
npm run test:integration
npm run test:session
npm run test:load
npm run check:offline
npm run rc:audit
npm run sbom:generate
```

A verificação remota de dependências é executada por `npm run check`, quando o registro npm estiver acessível.

## Estrutura

```text
apps/api                 API Fastify
apps/foundry-module      módulo Foundry VTT
packages/*               serviços independentes
scripts/*                testes, migrações, auditoria e distribuição
docs/*                   documentação operacional e técnica
data/*                    estado local ignorado pelo Git
```

O pipeline principal permanece:

```text
Captura → Intenção → Contexto normalizado → Regras/Simulação → Narração → Publicação no Foundry
```

Consulte [Arquitetura](docs/ARCHITECTURE.md), [Instalação](docs/INSTALLATION.md), [Solução de problemas](docs/TROUBLESHOOTING.md), [Segurança](SECURITY.md) e [Limitações conhecidas](docs/KNOWN-LIMITATIONS.md).

## Estado do RC

- Release Candidate gerada e auditada offline.
- SBOM CycloneDX e checksums incluídos nos artefatos de distribuição.
- Marco 13, validação real no Foundry com múltiplos clientes, permanece pendente e será executado antes da versão `1.0.0` estável.

## Licença

O projeto está marcado como `UNLICENSED`. Consulte [NOTICE.md](NOTICE.md). Nenhum direito de redistribuição ou uso comercial é concedido implicitamente.
