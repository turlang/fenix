# Content Importer v1.7 — Validação Física no Foundry

## Objetivo

Fechar com evidência real o gate físico do Content Importer v1.7 antes de iniciar o v1.8.

Este procedimento deve ser executado por um GM em uma instalação real do Foundry VTT 13 com dnd5e 5.x. O CI e fixtures sintéticas não contam como confirmação física.

## Pré-requisitos

- Foundry VTT 13 alvo;
- dnd5e 5.x ativo;
- módulo `mestre-orc` desta branch instalado e habilitado;
- Engine Fênix acessível, normalmente em `http://localhost:3001`, caso o sync seja testado;
- uma Adventure já importada no Fênix para o teste de sync;
- um `JournalEntry` ou `JournalEntryPage` real que contenha referências UUID explícitas para pelo menos um Actor, um Item/Spell e uma RollTable.

## Runner de um comando

Depois do mundo carregar, abra o console do navegador do Foundry como GM e execute:

```js
await game.modules.get('mestre-orc').api.runLiveValidation({
  rootUuid: 'JournalEntry.SEUIDAQUI',
  campaignId: 'ID_DA_CAMPANHA_FENIX',
  adventureId: 'ID_DA_ADVENTURE_FENIX',
  apiUrl: 'http://localhost:3001'
});
```

Para validar apenas o Bridge local, sem enviar o envelope ao Fênix:

```js
await game.modules.get('mestre-orc').api.runLiveValidation({
  rootUuid: 'JournalEntry.SEUIDAQUI'
});
```

## O que o runner verifica automaticamente

- Foundry major 13;
- sistema `dnd5e`;
- dnd5e major 5;
- disponibilidade de `fromUuid`, JournalEntry/Page, Actor, Item e RollTable;
- crawl limitado por profundidade e quantidade;
- observação real de Actor, Item e RollTable nas referências percorridas;
- ausência de UUID explícito não resolvido;
- envio opcional do envelope Bridge v3 ao Fênix.

O console exibe `console.table` com cada check e retorna `fenix.foundry-physical-validation-report`.

## Regra fail-closed

Mesmo quando `automatedPassed === true`, o relatório mantém:

```text
physicalValidationConfirmed = false
```

Isto é intencional. Quatro verificações exigem ação humana e não podem ser declaradas pelo código.

## Passos manuais obrigatórios

1. No Review Workspace do Fênix, confirmar uma alteração ou conflito recebido do Foundry.
2. Promover pelo menos uma entidade importada para entidade nativa Fênix.
3. Alterar a entidade nativa, alterar novamente a mesma fonte no Foundry e sincronizar; o estado deve virar conflito fail-closed, sem overwrite silencioso.
4. Remover a entidade na fonte Foundry, sincronizar e confirmar que a entidade nativa Fênix continua preservada.

## Evidência a registrar

Para fechar o gate, registrar no PR de validação:

- versão Foundry observada;
- sistema e versão observados;
- `rootUuid` usado (sem incluir conteúdo protegido no repositório);
- tipos resolvidos: Actor, Item e RollTable;
- resultado `automatedPassed`;
- resultado do sync;
- confirmação dos quatro passos manuais;
- qualquer incompatibilidade observada.

Não versionar exports de conteúdo comercial/protegido como fixture. Use apenas identificadores e resultado operacional necessário para provar compatibilidade.

## Próximo marco

Somente depois desse gate físico: **Content Importer v1.8 — Compendium Resolution & Asset Provenance**.
