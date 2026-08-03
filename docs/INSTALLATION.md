# Instalação do Mestre Orc

## Requisitos

- Windows 10 ou 11 para o instalador PowerShell.
- Node.js 20, 22 ou 24.
- Foundry VTT 13.
- Acesso ao diretório de dados do Foundry.

## Instalação pelo bundle Windows

1. Extraia `mestre-orc-windows-bundle-<versão>.zip`.
2. Abra PowerShell na pasta `windows`.
3. Execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-mestre-orc.ps1
```

O instalador copia o Engine para `%LOCALAPPDATA%\MestreOrc\engine`, instala o módulo em `%LOCALAPPDATA%\FoundryVTT\Data\modules\mestre-orc`, cria `.env` a partir de `.env.example`, instala dependências e executa as migrações iniciais.

Para usar outro diretório do Foundry:

```powershell
.\install-mestre-orc.ps1 -FoundryDataPath "D:\FoundryData"
```

## Inicialização

Revise o arquivo `.env` e execute:

```powershell
& "$env:LOCALAPPDATA\MestreOrc\start-mestre-orc.ps1"
```

Depois, abra o Foundry e ative o módulo **Mestre Orc** no mundo desejado.

## Instalação manual

1. Extraia o ZIP do Engine.
2. Execute `npm ci --omit=dev --ignore-scripts`.
3. Copie `.env.example` para `.env` e configure os provedores.
4. Execute `npm run migrate:apply`.
5. Inicie com `npm start`.
6. Extraia o ZIP do módulo em `<FoundryData>/modules/mestre-orc`.
