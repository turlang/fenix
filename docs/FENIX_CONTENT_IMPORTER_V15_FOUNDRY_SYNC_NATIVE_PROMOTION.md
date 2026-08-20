# Content Importer v1.5 — Foundry Bridge Sync & Native Entity Promotion

## Objetivo

O v1.5 transforma o adapter Foundry do Fênix de importação pontual em uma ponte de sincronização incremental, mantendo o Core independente do Foundry e preservando a autoridade local do Fênix.

## Fluxo

1. O Mestre escolhe um `JournalEntry` ou `JournalEntryPage` no Foundry.
2. O Bridge resolve o UUID com `fromUuid()` dentro do runtime autorizado do Foundry.
3. Referências explícitas são seguidas de forma limitada por profundidade e quantidade.
4. O Bridge envia `fenix.bridge-content-sync` v2 para a aventura já importada no Fênix.
5. O Content Importer recompila o Entity Graph usando `sourceUuid` como identidade e `sourceHash` como fingerprint.
6. O Fênix compara fonte, baseline de promoção e estado atual da entidade nativa.
7. Divergência simultânea vira `conflict`; nenhuma entidade nativa é sobrescrita sem decisão explícita do Mestre.

## Bridge Foundry v2

O módulo Foundry carrega `scripts/content-sync.js` antes do runtime principal e expõe ao GM:

```js
game.modules.get('mestre-orc').api.resolveContentPackage({ rootUuid })
game.modules.get('mestre-orc').api.syncContent({ campaignId, adventureId, rootUuid })
```

A resolução aceita `JournalEntry` ou `JournalEntryPage` como raiz. `Actor`, `Item` e `RollTable` referenciados podem ser materializados no pacote. Referências ausentes são reportadas como `missingUuids`; não são adivinhadas ou baixadas por outro canal.

Guardrails do Bridge:

- GM-only;
- `fromUuid()` executado apenas dentro do Foundry;
- máximo configurável de entidades, limitado pelo código a 256;
- profundidade máxima limitada a 4;
- sem crawl recursivo ilimitado;
- HTML permanece dado, não código executável;
- credenciais do Engine não entram no Adventure Model.

## Sync diferencial

`fenix.foundry-sync-state` v1 classifica cada `sourceUuid` em:

- `new`: existe apenas na nova fonte;
- `unchanged`: `sourceHash` não mudou;
- `changed`: a fonte mudou e não há conflito local;
- `conflict`: fonte e entidade promovida divergiram, ou a fonte removeu uma entidade promovida.

A remoção de uma entidade no Foundry nunca é autorização para remover o Actor/Item nativo do Fênix.

### Resolução de conflito

A API aceita decisões explícitas:

- `keep-local`: preserva a entidade nativa e reconhece o novo baseline da fonte;
- `accept-source`: reaplica a entidade importada ao mesmo native ID; não é permitido quando a fonte foi removida;
- `detach`: mantém a entidade nativa e remove a expectativa de sincronização ativa.

## Promoção nativa

A promoção é sempre uma ação GM-reviewed.

### Actor / NPC

`Actor` e `npc` do Entity Graph podem ser promovidos através do `CampaignActorService`. O Fênix cria IDs nativos determinísticos derivados do `sourceUuid`, preserva proveniência em `sheet.metadata` e converte apenas fatos universais seguros, como HP/AC e velocidades conhecidas.

O Foundry não se torna autoridade do Sheet nativo. Dados específicos do sistema permanecem no Knowledge/Source até que um Rules Adapter do sistema saiba convertê-los de forma explícita.

### Item / Spell

O v1.5 introduz `CampaignItemService`, um catálogo GM-only persistido em `campaign.items`. Item e spell promovidos preservam `sourceUuid`, `sourceHash`, facts normalizados e texto seguro. Edições posteriores no Fênix marcam `sourceSync.localModified=true`.

## API

Novas rotas autenticadas:

- `POST /v1/campaigns/:campaignId/content/:adventureId/sync-foundry`
- `POST /v1/campaigns/:campaignId/content/:adventureId/sync-foundry/resolve`
- `POST /v1/campaigns/:campaignId/content/:adventureId/entities/:sourceUuid/promote`
- `GET /v1/campaigns/:campaignId/items`
- `GET /v1/campaigns/:campaignId/items/:itemId`
- `POST /v1/campaigns/:campaignId/items/:itemId`

## Segurança e autoridade

- RBAC do Fênix continua sendo a autoridade de acesso; ownership do Foundry é apenas metadado de origem.
- O Bridge não altera Scene, Wall, Door, Region, Token ou regras de movimento.
- Knowledge continua não autoritativo para física e regras.
- Re-sync não sobrescreve silenciosamente alterações locais.
- Fonte removida não exclui entidade nativa.
- Conteúdo HTML importado nunca é executado.

## Validação

A suíte v1.5 usa material sintético e cobre:

- envelope Bridge v2;
- conflito fonte + edição local;
- remoção de fonte com preservação nativa;
- catálogo Item/Spell e marcação de edição local;
- promoção explícita de Actor;
- sync sem overwrite local;
- presença do GM gate, `fromUuid()`, limites de crawl e endpoint de sync no módulo Foundry.

O CI hospedado não executa uma instância Foundry real. Portanto, a existência e os guardrails do caminho `fromUuid()` são validados em código/testes, mas a validação física contra Foundry VTT ativo deve ser registrada separadamente.

## Próximo passo sugerido

Depois do v1.5, o próximo avanço natural é o **Content Importer v1.6 — Sync Review UX & System-Native Mapping**: levar conflitos/promoções para uma experiência completa no Review Workspace e adicionar mapeadores por sistema RPG para conversão de Sheet/Item sem perder dados específicos do sistema.
