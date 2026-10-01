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
- um `JournalEntry` ou `JournalEntryPage` real;
- para cobertura live completa, o mundo deve possuir pelo menos um Actor, um Item (world ou embutido em Actor) e uma RollTable resolvíveis por `fromUuid()`.

O Journal **não precisa** possuir referências `@UUID[...]` para a parte automatizada da validação. Muitos mundos reais não usam esses links. O runner mantém duas evidências separadas:

1. **crawl do Journal** — somente referências UUID explícitas podem entrar no envelope de sync;
2. **probe live do mundo** — Actor, Item e RollTable existentes são resolvidos por `fromUuid()` apenas para provar compatibilidade física.

O probe live nunca injeta entidades no envelope de sync e não amplia a autoridade do Bridge.

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

O runner exibe duas tabelas: os checks automatizados e a evidência live de Actor/Item/RollTable.

## O que o runner verifica automaticamente

- Foundry major 13;
- sistema `dnd5e`;
- dnd5e major 5;
- disponibilidade de `fromUuid`, JournalEntry/Page, Actor, Item e RollTable;
- crawl do Journal limitado por profundidade e quantidade;
- cobertura real de Actor, Item e RollTable por uma combinação de referências explícitas e probe live do mundo;
- ausência de UUID explícito não resolvido no crawl do Journal;
- envio opcional do envelope Bridge v3 ao Fênix.

O console retorna `fenix.foundry-physical-validation-report` com:

- `bridge.resolvedEntityTypes`: tipos encontrados pelo crawl explícito do Journal;
- `bridge.liveEntityEvidence`: amostras reais resolvidas diretamente do mundo;
- `bridge.observedEntityTypes`: união das duas fontes de evidência.

## Regra de segurança do sync

O probe live existe somente para validação física. Ele **não** adiciona Actor, Item ou RollTable ao `fenix.bridge-content-sync`.

O sync continua obedecendo a política do Bridge v3: apenas entidades alcançadas por UUID explícito no conteúdo de origem podem entrar no envelope. Isso evita descoberta irrestrita do mundo e preserva provenance.

Se a aventura não possui nenhuma referência UUID explícita, a validação automatizada ainda pode passar, mas os passos manuais de promoção/conflito exigirão uma fonte de teste com links explícitos. Pode ser usado um Journal temporário dedicado à validação, sem alterar ou versionar conteúdo comercial da aventura.

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
- tipos observados: Actor, Item e RollTable;
- origem da evidência de cada tipo (`crawl` ou `probe live`);
- resultado `automatedPassed`;
- resultado do sync;
- confirmação dos quatro passos manuais;
- qualquer incompatibilidade observada.

Não versionar exports de conteúdo comercial/protegido como fixture. Use apenas identificadores e resultado operacional necessário para provar compatibilidade.

## Próximo marco

Somente depois desse gate físico: **Content Importer v1.8 — Compendium Resolution & Asset Provenance**.
