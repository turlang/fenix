# Atualização e rollback

## Atualização pelo bundle Windows

Feche o Foundry e interrompa a API antes de atualizar. Extraia o novo bundle e execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\update-mestre-orc.ps1
```

O atualizador:

1. prepara a nova versão fora da instalação ativa;
2. preserva `.env` e a pasta `data`;
3. instala as dependências;
4. inspeciona e migra uma cópia dos dados;
5. valida Engine e módulo;
6. cria um ponto de rollback;
7. troca os arquivos somente depois de todas as validações.

## Rollback

```powershell
.\rollback-mestre-orc.ps1
```

O rollback restaura o último Engine e módulo preservados. A versão que falhou é movida para uma pasta `failed-<data>` para análise.

## Atualização manual

Antes de substituir arquivos:

```powershell
npm run migrate:inspect
npm run migrate:apply
npm run install:verify
```

Nunca apague `.env`, `data/` ou `data/backups/` durante uma atualização.
