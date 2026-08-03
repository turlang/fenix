# Solução de problemas

## A API não inicia

1. Confirme Node.js 20, 22 ou 24.
2. Execute `npm run validate`.
3. Verifique o `.env`.
4. Ao usar `HOST=0.0.0.0`, configure `MESTRE_ORC_API_TOKEN` com 24 ou mais caracteres.
5. Confira se a porta 3001 está livre.

## O Foundry mostra falha de conexão

- Confirme o endereço configurado em **Configurações do módulo → Endereço da API Mestre Orc**.
- Se a API exigir token, configure o mesmo valor em **Token de acesso da API**.
- Em Foundry HTTPS, use uma API HTTPS para evitar mixed content.
- Adicione a origem exata do Foundry em `CORS_ALLOWED_ORIGINS`.

## Erro 401

O token está ausente ou diferente. Reinicie o Engine após alterar `.env` e atualize o token no navegador que executa o Foundry.

## Erro 403 de origem

A origem do navegador não está na allowlist CORS. Não use `*`; adicione o endereço completo.

## Erro 429

O limite de requisições foi atingido. Aguarde o `Retry-After` ou ajuste `MESTRE_ORC_RATE_LIMIT_MAX` e `MESTRE_ORC_RATE_LIMIT_WINDOW_MS` com cuidado.

## Microfone ou TTS

- Reconhecimento de voz depende de suporte do navegador e permissão de microfone.
- Use HTTPS ou `localhost`.
- TTS local varia conforme as vozes instaladas.
- Em falha neural, use `neural-auto` para permitir fallback local.

## Diagnóstico

Abra **Central Mestre Orc → Sistema → Diagnóstico** e execute o diagnóstico completo. Antes de compartilhar o JSON, revise nomes de campanha, Scene e usuário.
