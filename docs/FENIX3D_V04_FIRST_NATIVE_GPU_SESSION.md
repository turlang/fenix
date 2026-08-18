# Fenix3D v0.4 — First Native GPU Session

Este marco fecha a diferença entre "processo Unreal iniciado" e "sessão Fênix 3D realmente inicializada".

## Critério de verdade

Uma sessão nativa só é considerada pronta quando **duas provas independentes** passam:

1. **Runtime evidence** do `Fenix3D.exe`
   - `renderSessionId` correto;
   - campanha/cena/ator/token corretos;
   - manifest `fenix.3d-runtime-manifest` v1 carregado;
   - `WorldBuilder` construiu a cena;
   - canal autoritativo de controle está configurado;
   - stage final `ready`.
2. **Pixel Streaming readiness**
   - o frontend/signalling configurado responde dentro do timeout;
   - o processo continua vivo;
   - a sessão possui `PixelStreamingID=<renderSessionId>`.

Se qualquer prova falhar, o Render Node encerra o processo e remove a alocação.

## Credenciais

O executável Unreal recebe apenas credenciais efêmeras da própria sessão:

- `FENIX_RUNTIME_MANIFEST_TOKEN`;
- `FENIX_RUNTIME_STATUS_TOKEN`;
- `FENIX_RUNTIME_CONTROL_TOKEN`.

O `FENIX_RENDER_NODE_TOKEN` administrativo **não é entregue ao Unreal nem ao navegador**.

## Runtime evidence

O Fenix3D envia os stages em ordem:

```text
booting
  -> manifest-ready
  -> ready
```

Falhas de bootstrap usam:

```text
failed
```

O endpoint interno é:

```text
POST /v1/runtime/status/:renderSessionId
```

Ele exige o token efêmero daquela sessão e rejeita divergência de campanha, cena, ator ou token.

O operador pode consultar a evidência com o Bearer administrativo:

```text
GET /v1/render-sessions/:renderSessionId/runtime-status
```

## Configuração obrigatória do GPU Node

No arquivo local de ambiente:

```text
FENIX_RENDER_RUNTIME_MODE=process
FENIX_RENDER_RUNTIME_EVIDENCE_REQUIRED=true
FENIX_RENDER_RUNTIME_EVIDENCE_TIMEOUT_MS=20000
FENIX_RENDER_RUNTIME_EVIDENCE_INTERVAL_MS=250
FENIX_RENDER_RUNTIME_READY_URL_TEMPLATE=https://stream.example.com/?streamerId={renderSessionId}
```

Use `deploy/gpu-node/fenix3d-gpu.env.example` como referência. Não versione o arquivo real com segredos.

## Runner nativo

O GitHub runner precisa ter os labels:

```text
self-hosted
Windows
X64
fenix3d
```

E as variáveis/secrets:

- `FENIX_UNREAL_ENGINE_ROOT`;
- `FENIX_UNREAL_ARCHIVE_DIR`;
- `FENIX_RENDER_NODE_INTERNAL_URL`;
- secret `FENIX_RENDER_NODE_TOKEN`.

## Workflow

Execute `Fenix3D Native` com:

- `package_runtime = true`;
- `run_stream_smoke = true`.

O workflow realiza:

```text
GPU/UE5.5 preflight
  -> C++ native build
  -> Win64 package
  -> Render Node process session
  -> runtime evidence
  -> Pixel Streaming readiness
  -> player HTTP probe
  -> cleanup da sessão
  -> upload do evidence artifact
```

## Artifact

Uma execução aprovada gera:

```text
fenix3d-native-session-evidence
  artifacts/fenix3d-native-session.json
```

Schema esperado:

```json
{
  "schema": "fenix.native-gpu-session-evidence",
  "version": 1,
  "passed": true,
  "renderSessionId": "...",
  "processPid": 1234,
  "runtimeEvidence": {
    "stage": "ready",
    "worldBuilt": true,
    "controlConfigured": true,
    "manifest": {
      "schema": "fenix.3d-runtime-manifest",
      "version": 1
    }
  }
}
```

## Aceitação física/manual

Depois do smoke automatizado, abrir o `playerUrl` em um navegador fora do GPU Node e validar:

1. a cena técnica aparece em primeira pessoa;
2. a câmera nasce no token/viewer correto;
3. mouse altera a visão;
4. WASD envia intenção ao Core;
5. tentar atravessar uma parede é bloqueado pelo Core;
6. a reconciliação retorna a câmera à posição autoritativa;
7. voltar para Top View encerra a sessão remota e libera o processo GPU.

## Estado do marco

O código do v0.4 pode ser promovido com a CI normal verde porque ele não quebra o VTT existente. Entretanto, **First Native GPU Session validada** só pode ser declarada depois que o workflow self-hosted produzir o artifact de evidência e a caminhada manual acima for confirmada em hardware real.
