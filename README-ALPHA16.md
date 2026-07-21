# Mestre Orc 0.1.0-alpha.16

Narração em áudio com TTS do navegador e transmissão pelo socket do Foundry.

## Mudanças

- Novo `AudioNarrationService` no Engine.
- O endpoint `/v1/session/start` retorna a abertura e uma diretiva de áudio `browser-tts`.
- O módulo publica o texto no chat e reproduz a mesma narração com `SpeechSynthesisUtterance`.
- A diretiva é transmitida pelo canal `module.mestre-orc` para os demais clientes conectados.
- Cada usuário pode ligar ou desligar o áudio no botão exibido junto ao chat.
- Voz, velocidade, tom e volume podem ser configurados nas opções do módulo.
- Uma nova narração interrompe a anterior para evitar sobreposição.
- O Engine continua sendo responsável pelo texto; o navegador apenas converte a versão aprovada em voz.

## Fluxo

```text
Read-aloud
→ Groq interpreta
→ SafetyGuard
→ NarrationQualityGuard
→ NoveltyGuard
→ texto aprovado
→ AudioNarrationService
→ chat + TTS local
→ socket do Foundry
→ TTS nos clientes com áudio ativo
```

## Limitação desta etapa

A voz depende das vozes instaladas em cada navegador e pode variar entre jogadores. Esta versão valida a reprodução e a transmissão. Uma futura voz neural gerada pelo Engine poderá substituir o `browser-tts` sem alterar o restante do pipeline.

## Instalação

Preserve `.env` e `data/narration-history.json`. Depois execute:

```powershell
npm install
npm test
npm run dev
```

Em `http://localhost:3001/health`, confirme:

```json
{
  "version": "0.1.0-alpha.16",
  "ai": "groq",
  "audio": "browser-tts"
}
```
