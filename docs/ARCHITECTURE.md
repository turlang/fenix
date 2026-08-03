# Arquitetura

## Visão geral

O Mestre Orc é dividido em um módulo Foundry e um Engine Node.js. O módulo coleta somente o contexto necessário, aplica as permissões do cliente e publica os resultados. O Engine normaliza, interpreta, consulta regras, produz a narração e mantém os serviços persistentes.

## Pipeline obrigatório

```text
Captura
→ IntentInterpreter
→ NarrationContextBuilder
→ RulesService / CombatService / WorldState
→ NarrationService / QualityGuard / NoveltyGuard
→ AudioNarrationService
→ FoundryPublisher
```

Todo estado vindo do Foundry deve passar pelo `NarrationContextBuilder` antes de ser usado por serviços narrativos.

## Serviços

- `SessionDirector`: coordena uma execução sem incorporar regras específicas.
- `SessionRuntime`: mantém sessão, rodada e combate.
- `AI Provider`: provedores, fallback e circuit breaker.
- `NarrationService`: prompts, segurança e saída estruturada.
- `Memory`, `AdventureLibrary`, `GeneratorService`, `MapService`: persistência e contexto de campanha.
- `TutorService`, `AutomationService`, `BackupService`, `DiagnosticService`: ferramentas administrativas.
- `MigrationService`: schema, snapshots e rollback.
- `ApiSecurity`: token, cabeçalhos e rate limit.

## Limites de confiança

1. O Foundry decide ownership e disponibilidade visual.
2. O Engine valida formato, tamanho, CORS, token e limites de requisição.
3. Provedores externos recebem somente o contexto necessário para a operação.
4. Segredos do mestre não entram em saídas para jogadores.
5. A IA nunca executa mudanças diretamente; automações exigem aprovação e execução no Foundry.

## Persistência

Todos os serviços usam `MESTRE_ORC_DATA_DIRECTORY` ou um caminho específico. Gravações importantes são atômicas e migrações criam snapshot antes de alterar dados.
