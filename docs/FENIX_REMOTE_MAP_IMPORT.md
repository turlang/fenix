# Fênix VTT — Importação de mapas por URL

O Scene Manager aceita duas origens de battlemap:

1. **Arquivo local**: PNG, JPG/JPEG ou WEBP enviado pelo Mestre.
2. **URL HTTP/HTTPS**: o Engine baixa a imagem, valida o conteúdo e grava uma cópia no `AssetStorage` da campanha.

A URL remota não permanece como dependência da cena. Depois da importação, o renderer recebe o mesmo asset local usado no fluxo de upload. Isso evita problemas futuros de CORS, hotlink, URL expirada ou indisponibilidade do host de origem.

## Fluxo

```text
Mestre cola URL
      ↓
POST /v1/campaigns/:campaignId/assets/import-url
      ↓
Auth + role GM
      ↓
RemoteMapImporter
      ├─ valida HTTP/HTTPS
      ├─ bloqueia localhost/redes privadas
      ├─ resolve DNS e fixa o IP validado no request
      ├─ revalida cada redirect
      ├─ limita timeout/tamanho
      ├─ valida assinatura PNG/JPEG/WEBP
      └─ extrai largura/altura
      ↓
LocalAssetStorage
      ↓
CampaignSceneService
      ↓
Scene.backgroundAssetId
      ↓
Fênix VTT
```

## Segurança contra SSRF

O import é feito pelo Engine, portanto URLs fornecidas pelo usuário são consideradas não confiáveis.

O importador:

- aceita apenas `http:` e `https:`;
- rejeita credenciais embutidas na URL;
- bloqueia `localhost` e sufixos locais/reservados;
- bloqueia IPv4/IPv6 privados, loopback, link-local, multicast e faixas reservadas cobertas pelo filtro;
- resolve o hostname antes da conexão e fixa o endereço validado no `lookup` usado por `http`/`https`, reduzindo risco de DNS rebinding;
- revalida o destino de cada redirect;
- limita redirects;
- aplica timeout;
- limita o download ao mesmo `FENIX_ASSET_MAX_BYTES` usado pelo upload local;
- verifica magic bytes do arquivo, não confiando apenas em `Content-Type` ou extensão;
- restringe dimensões a no máximo 20.000 × 20.000 px.

A URL completa de origem **não é persistida**. O asset guarda apenas `sourceType=remote-import` e `sourceHost`, evitando gravar query strings assinadas ou tokens temporários.

## Configuração

```env
FENIX_ASSET_MAX_BYTES=15728640
FENIX_REMOTE_MAP_TIMEOUT_MS=10000
FENIX_REMOTE_MAP_MAX_REDIRECTS=3
```

- `FENIX_ASSET_MAX_BYTES`: limite máximo do mapa, compartilhado por upload e importação remota.
- `FENIX_REMOTE_MAP_TIMEOUT_MS`: 1.000–60.000 ms.
- `FENIX_REMOTE_MAP_MAX_REDIRECTS`: 0–5.

## Permissões

Somente membros com papel `gm` podem enviar/importar mapas, criar cenas, ativar cenas e calibrar a grade. Jogadores autenticados podem ler os assets pertencentes à campanha da qual são membros, mas não alterar o catálogo.

## Limites atuais

O storage atual é filesystem local. Em deploy com múltiplas réplicas, use volume compartilhado enquanto o adapter de object storage (S3/R2 equivalente) não estiver disponível.

A importação aceita uma URL direta para a imagem. Uma página HTML de Pinterest, Reddit, Google Images ou outro site não é tratada como battlemap e será rejeitada pela validação de assinatura.