# Contribuição

1. Use Node.js 20, 22 ou 24.
2. Preserve o pipeline Captura → Intenção → Contexto → Regras → Narração → Foundry.
3. Normalize dados do Foundry pelo `NarrationContextBuilder`.
4. Injete serviços no `SessionDirector`; não crie acoplamentos globais.
5. Não inclua `.env`, tokens, `data/`, backups, relatórios ou `node_modules`.
6. Adicione testes para toda correção ou alteração de comportamento.

## Validação obrigatória

```bash
npm ci --ignore-scripts
npm run check:offline
npm run release:audit
```

Quando o registro npm estiver acessível, execute também:

```bash
npm run check
```

Mudanças em sessão, combate, persistência ou atualização devem executar separadamente os testes de integração, sessão e carga. O PR deve mencionar qualquer limitação não testada em Foundry real.
