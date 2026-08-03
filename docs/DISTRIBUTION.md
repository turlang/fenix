# Distribuição e releases

## Gate do Release Candidate

```bash
npm run check
npm run release:build
npm run install:verify
```

Em ambiente sem acesso ao registro npm:

```bash
npm run check:offline
```

## Artefatos

`npm run release:build` gera em `dist/distribution/`:

- ZIP do Engine;
- ZIP do módulo Foundry;
- bundle Windows;
- `module.json`;
- `release-manifest.json`;
- `checksums.sha256`;
- `release-candidate-audit.json`;
- `mestre-orc-sbom.cdx.json`.

Use `MESTRE_ORC_RELEASE_BASE_URL` para preencher `manifest` e `download`. Tags `v*` acionam a workflow de GitHub Release.

A versão estável não deve ser publicada enquanto os itens físicos pendentes em `docs/RELEASE-CHECKLIST.md` não estiverem concluídos.
