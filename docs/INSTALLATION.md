# Instalação do Mestre Orc 1.0.0-rc.3

## Requisitos

- Windows 10/11 para o instalador PowerShell, ou instalação manual em sistema compatível com Node.js.
- Node.js 20, 22 ou 24.
- Foundry VTT 13.
- Acesso ao diretório de dados do Foundry.

## Bundle Windows

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-mestre-orc.ps1
```

O instalador copia o Engine, instala o módulo, cria `.env`, instala dependências e executa migrações. Para outro diretório:

```powershell
.\install-mestre-orc.ps1 -FoundryDataPath "D:\FoundryData"
```

## Inicialização local

O padrão seguro é:

```env
HOST=127.0.0.1
MESTRE_ORC_REQUIRE_API_TOKEN=
```

Inicie com:

```powershell
& "$env:LOCALAPPDATA\MestreOrc\start-mestre-orc.ps1"
```

No Foundry, mantenha `http://localhost:3001` como endereço da API.

## Acesso em rede

Ao permitir que outros computadores acessem o Engine:

```env
HOST=0.0.0.0
MESTRE_ORC_API_TOKEN=um-token-aleatorio-com-ao-menos-24-caracteres
MESTRE_ORC_REQUIRE_API_TOKEN=true
CORS_ALLOWED_ORIGINS=https://endereco-exato-do-foundry
```

Reinicie o Engine e configure o mesmo endereço e token nas opções do módulo em cada navegador que fará chamadas à API. Prefira HTTPS e firewall restritivo.

## Instalação manual

```bash
npm ci --omit=dev --ignore-scripts
cp .env.example .env
npm run migrate:apply
npm start
```

Extraia o módulo em `<FoundryData>/modules/mestre-orc` e ative-o no mundo.
