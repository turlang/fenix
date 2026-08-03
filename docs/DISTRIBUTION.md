# Distribuição e releases

Execute:

```bash
npm run release:build
```

Os artefatos são gerados em `dist/distribution/`:

- ZIP limpo do Engine;
- ZIP instalável do módulo Foundry;
- bundle Windows com instalador, atualizador e rollback;
- `module.json` para instalação por manifesto;
- `release-manifest.json`;
- `checksums.sha256`.

Para preencher os campos `manifest` e `download` do módulo:

```bash
MESTRE_ORC_RELEASE_BASE_URL="https://host/releases/download/vX" npm run release:build
```

A workflow `release.yml` executa validações, gera os artefatos e publica uma GitHub Release quando uma tag `v*` é enviada.
