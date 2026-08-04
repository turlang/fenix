# Distribuição e releases

## Gate da versão estável

```bash
npm run check
npm run release:build
npm run install:verify
```

Em ambiente sem acesso ao registro npm:

```bash
npm run check:offline
```

A promoção estável pode ser executada com:

```bash
npm run release:stable
```

## Artefatos

`npm run release:build` gera em `dist/distribution/`:

- ZIP do Engine;
- ZIP do módulo Foundry;
- bundle Windows;
- `module.json`;
- `mestre-orc-<versão>-release-manifest.json`;
- `mestre-orc-<versão>-checksums.sha256`;
- `mestre-orc-<versão>-audit.json`;
- `mestre-orc-<versão>-sbom.cdx.json`.

Use `MESTRE_ORC_RELEASE_BASE_URL` para preencher `manifest` e `download`. Tags `v*` acionam a workflow de GitHub Release.

Antes de publicar, confirme que `docs/RELEASE-CHECKLIST.md` permanece totalmente concluído e que os checksums correspondem aos artefatos enviados.
