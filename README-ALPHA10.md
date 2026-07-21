# Mestre Orc Reboot v0.1.0-alpha.10

Hotfix do contrato Scene → Journal → Page.

O `NarrationContextBuilder` agora preserva os metadados produzidos pelo módulo Foundry:

- `explicitLink`
- `linkSource`
- `sectionMatchedScene`
- `sceneSectionName`
- `areaName`
- `extractionMode`
- `fullPageContentAvailable`

Isso permite ao `SceneOpeningContextBuilder` reconhecer corretamente o bloco `STRUCTURED_READ_ALOUD` extraído de `Cragmaw Hideout → 1. Cave Mouth`, mesmo quando a página se chama `Part 1 — Goblin Arrows`.
