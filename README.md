# Mestre Orc Engine

Versão `0.1.0-alpha.24` — Node.js 20–24 e Foundry VTT 13.

O fluxo atual localiza a Scene ativa, procura o Journal correspondente no diretório do Foundry, extrai exclusivamente a caixa `.ve-rd__b-inset--readaloud`, interpreta a âncora canônica com Groq, valida qualidade e novidade, publica no chat e reproduz a narração em áudio.

## Engine

Instale as dependências e crie a configuração local:

```powershell
npm ci
Copy-Item .env.example .env
npm run check
npm run dev
```

Preencha o `.env` sem versionar chaves:

```env
PORT=3001
HOST=0.0.0.0
NODE_ENV=development
CORS_ALLOWED_ORIGINS=http://localhost:30000,http://127.0.0.1:30000,http://localhost:3000,http://localhost:3001
GROQ_API_KEY=sua_chave
GROQ_MODEL=seu_modelo_disponivel
MESTRE_ORC_NARRATION_MEMORY_FILE=./data/narration-history.json
MESTRE_ORC_AUDIO_ENABLED=true
MESTRE_ORC_AUDIO_MODE=browser-tts
MESTRE_ORC_AUDIO_LANGUAGE=pt-BR
MESTRE_ORC_AUDIO_RATE=0.90
MESTRE_ORC_AUDIO_PITCH=0.85
MESTRE_ORC_AUDIO_VOLUME=1.00
```

Abra `http://localhost:3001/health`. Os campos esperados são `"ai":"groq"` e `"audio":"browser-tts"`.

## Comandos

- `npm run dev`: inicia a API.
- `npm test`: executa os testes automatizados.
- `npm run validate`: valida a estrutura e as versões.
- `npm run check`: executa a validação completa antes de entrega.

## Segurança e operação

- Nunca inclua `.env`, `node_modules` ou dados gerados em commits e releases.
- Em produção, configure `NODE_ENV=production` e informe somente origens confiáveis em `CORS_ALLOWED_ORIGINS`.
- A API limita o corpo das requisições e valida a ação recebida.
- Erros internos não expõem detalhes em produção; cada resposta inclui um identificador de requisição.
- O servidor encerra conexões corretamente ao receber `SIGINT` ou `SIGTERM`.

## Módulo Foundry

Copie o conteúdo de `apps/foundry-module` para:

```text
FoundryVTT/Data/modules/mestre-orc/
```

A pasta precisa conter diretamente `module.json`, `scripts/main.js` e `styles/mestre-orc.css`.

O botão **Áudio ligado/desligado** aparece junto ao chat para cada usuário. Nas configurações do módulo é possível ajustar voz, velocidade, tom e volume. O mestre pode desativar a transmissão para os demais clientes.

Depois que a sessão é iniciada, o módulo acompanha os tokens e identifica o número da sala mais próxima. Esse número é usado para procurar a seção correspondente no Journal relacionado à cena; o vínculo individual do marcador não é usado. O módulo extrai somente o read-aloud seguro e publica uma descrição curta com áudio. Cada sala é narrada uma vez por sessão e mantém histórico próprio entre sessões.

Durante uma sessão ativa, mensagens de jogadores no chat são classificadas como ações sociais, combate, investigação, movimento ou ação geral. O Engine identifica o alvo, produz o resultado básico de regras e relacionamento e devolve a consequência narrada em texto e áudio. Comandos iniciados por `/`, mensagens do GM e mensagens do próprio Mestre Orc são ignorados.

## Pipeline validado

```text
Scene ativa
→ Journal de mesmo nome
→ área inicial
→ caixa read-aloud
→ Groq
→ SafetyGuard
→ NarrationQualityGuard
→ NoveltyGuard
→ chat
→ AudioNarrationService
→ TTS local e transmissão pelo socket do Foundry
```

Os arquivos `README-ALPHA*.md` preservam o histórico de evolução das versões anteriores.

## Publicação no GitHub

Crie um repositório vazio no GitHub e execute na raiz do projeto:

```powershell
git init
git branch -M main
git add .
git commit -m "chore: prepare Mestre Orc Engine alpha.17"
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

Antes do primeiro push, confirme com `git status` que `.env`, `node_modules` e `data/narration-history.json` não aparecem na lista.
