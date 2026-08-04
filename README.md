# Mestre Orc Engine

**Versão:** `1.0.0`
**Compatibilidade:** Node.js 20–24 · Foundry VTT 13

Mestre Orc é um Engine modular de apoio a sessões de RPG no Foundry VTT. Ele combina narração cinematográfica, entrada e saída por voz, rodadas fora de combate, Combat Tracker, memória persistente, biblioteca de aventuras, criação assistida, mapas, tutores, automações aprovadas, diagnóstico, backup e atualização segura.

A versão `1.0.0` foi promovida após a validação física do Engine e do módulo no Foundry VTT 13, com Groq, microfone, reconhecimento de voz, Central Mestre Orc, diagnóstico, armazenamento e narração funcionando no ambiente real.

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

### Narração e voz

- Rodadas, investigações e combates passam por revisão automática antes da publicação.
- Resultados mecânicos não confirmados não aparecem como sucesso, falha, `total 0` ou `dano 0`.
- Marcações como `[foco]` e `[pausa]` orientam o áudio, mas são removidas do texto publicado no chat.
- O TTS local prioriza vozes naturais em português e usa variações sutis de velocidade, tom e pausa.

A qualidade do `browser-tts` depende das vozes instaladas no Windows e expostas ao Chromium do Foundry. Para maior naturalidade, configure OpenAI TTS, ElevenLabs ou um endpoint compatível no modo `neural-auto`.

## Início rápido

### Windows

1. Baixe e extraia `mestre-orc-windows-bundle-1.0.0.zip`.
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

Extraia o ZIP do módulo em `<FoundryData>/modules/mestre-orc`.

## Segurança da API

O Engine usa `127.0.0.1` por padrão. Para expô-lo na rede, configure um token forte:

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
npm run release:audit
npm run sbom:generate
```

A verificação remota de dependências é executada por `npm run check` quando o registro npm estiver acessível.

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

## Estado da versão

- Todos os marcos 1–18 foram concluídos.
- O Marco 13 foi validado no Foundry VTT 13 com Engine e módulo compatíveis.
- Groq, microfone, reconhecimento de voz, diagnóstico, armazenamento e Central Mestre Orc foram confirmados no ambiente real.
- A release inclui auditoria, SBOM CycloneDX, manifesto e checksums SHA-256.

## Licença

O projeto está marcado como `UNLICENSED`. Consulte [NOTICE.md](NOTICE.md). Nenhum direito de redistribuição ou uso comercial é concedido implicitamente.
