# Contribuição

1. Use Node.js entre as versões 20 e 24.
2. Crie uma branch curta e mantenha cada alteração com um único propósito.
3. Preserve o pipeline: captura, intenção, regras, narração e publicação.
4. Normalize qualquer dado do Foundry no `NarrationContextBuilder`.
5. Não acople serviços diretamente ao `SessionDirector`; injete dependências.
6. Execute `npm ci` e `npm run check` antes de enviar mudanças.
7. Inclua testes para correções e novos comportamentos.

Use mensagens de commit objetivas e não inclua segredos, dependências instaladas ou dados gerados.

## Validação do Marco 16

Antes de abrir um pull request que altere sessão, combate, memória, automações ou idempotência, execute:

```bash
npm run check:offline
```

Para investigar uma regressão específica, use separadamente `npm run test:integration`, `npm run test:session` e `npm run test:load`. Relatórios locais devem ser gravados em `reports/`, pasta ignorada pelo Git.

