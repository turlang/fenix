# Mestre Orc 0.1.0-alpha.14

Hotfix de segurança e interpretação narrativa.

## Mudanças

- O módulo Foundry envia exclusivamente o conteúdo de caixas `.ve-rd__b-inset--readaloud`.
- Foram removidos os fallbacks que transformavam cabeçalhos, texto plano ou o Journal inteiro em abertura.
- O Engine carrega automaticamente o arquivo `.env` existente na raiz do projeto.
- A sessão não publica mais um “modo local de diagnóstico” quando a Groq está ausente.
- O `SafetyGuard` rejeita cópia extensa do texto-fonte e sinais de conteúdo reservado ao mestre.
- O `NoveltyGuard` continua escolhendo a versão segura menos semelhante quando necessário.

## Configuração obrigatória

Crie ou preserve o arquivo `.env` na raiz:

```env
PORT=3001
GROQ_API_KEY=sua_chave
GROQ_MODEL=seu_modelo_disponivel
MESTRE_ORC_NARRATION_MEMORY_FILE=./data/narration-history.json
```

Depois execute:

```powershell
npm install
npm test
npm run dev
```

Confira `http://localhost:3001/health`. O campo `ai` precisa mostrar `groq`. Caso mostre `not-configured`, o Engine recusará a abertura em vez de publicar conteúdo bruto.
