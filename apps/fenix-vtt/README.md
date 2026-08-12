# Fênix VTT — Standalone Shell

Este diretório é a primeira aplicação standalone do Projeto Fênix. O objetivo desta entrega é provar as fronteiras antes de adicionar um segundo grafo de dependências ao monorepo.

## Estado desta entrega

- App Router source scaffold preparado para Next.js 15.
- Shell desktop/mobile com mapa como área principal, Scene Tree, Context Rail e Narration Timeline.
- `MapStage` é Client Component porque possui a única fronteira necessária com Canvas/WebGL e APIs do navegador.
- Renderer WebGL2 fica em `packages/webgl-map-renderer`; componentes React não conhecem regras, Groq, Guards ou `SessionDirector`.
- O mesmo Shared Core já pode executar com `StandaloneVttAdapter` por `vttContextPort`.

## Dependências

O `package.json` específico do Next/Tailwind não é adicionado nesta entrega de propósito. O CI atual registrou falha interna do npm (`Exit handler never called!`) durante `npm ci` em múltiplas versões de Node. Adicionar dependências sem conseguir gerar e validar um lockfile confiável violaria o protocolo fail-fast do projeto.

A próxima etapa de bootstrap adicionará Next.js 15, React e Tailwind CSS com lockfile validado quando o gate de dependências estiver estável. Até lá, o source scaffold e os contratos são verificáveis sem introduzir drift no `package-lock.json`.

## Fronteira obrigatória

```text
React/App Router -> Application/API -> Shared Core
Canvas ---------> MapRendererPort -> WebGL2/WebGPU adapter
Standalone state -> StandaloneVttAdapter -> VttContextPort
```

Nenhum componente desta aplicação pode importar `RulesService`, `NarrationService`, provider Groq ou código do módulo Foundry.
