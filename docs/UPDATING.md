# Atualização e rollback

Feche o Foundry e interrompa o Engine antes de atualizar.

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\update-mestre-orc.ps1
```

O atualizador prepara a versão fora da instalação ativa, preserva `.env` e `data/`, migra uma cópia, valida os artefatos e cria rollback antes da troca.

## Migração para o RC

- Revise `HOST`; o novo padrão é `127.0.0.1`.
- Em binding de rede, adicione `MESTRE_ORC_API_TOKEN` com 24+ caracteres.
- Configure URL e token nas opções do módulo Foundry.
- Execute `npm run rc:audit` após atualização manual.

## Rollback

```powershell
.\rollback-mestre-orc.ps1
```

Nunca apague `.env`, `data/`, `data/backups/` ou `data/migrations/` durante uma atualização.
