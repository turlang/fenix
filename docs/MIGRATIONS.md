# Migrações de dados

O Engine mantém um estado de schema em `data/migration-state.json`. Antes de qualquer alteração, cria snapshots em `data/migrations/`.

## Comandos

```bash
npm run migrate:inspect
npm run migrate:apply
node scripts/migrate-data.mjs apply --dry-run
node scripts/migrate-data.mjs list
node scripts/migrate-data.mjs rollback --snapshot <id>
```

## Fontes cobertas

- histórico narrativo;
- memória da campanha;
- biblioteca de aventuras;
- conteúdo gerado;
- plantas de mapas;
- perfis de voz;
- histórico dos tutores;
- propostas de automação.

Arquivos JSON inválidos interrompem a migração. O sistema não tenta corrigir silenciosamente um arquivo corrompido.

A migração automática é controlada por:

```env
MESTRE_ORC_DATA_DIRECTORY=./data
AUTO_MIGRATE_DATA=true
```

Defina `AUTO_MIGRATE_DATA=false` apenas quando a migração for administrada manualmente.
