[CmdletBinding()]
param(
  [string]$InstallRoot = "$env:LOCALAPPDATA\MestreOrc",
  [string]$FoundryDataPath = "$env:LOCALAPPDATA\FoundryVTT\Data",
  [switch]$Force,
  [switch]$SkipDependencies
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) { Write-Host "[Mestre Orc] $Message" -ForegroundColor Cyan }
function Assert-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw 'Node.js não encontrado. Instale uma versão entre 20 e 24.' }
  $major = [int](& node -p "Number(process.versions.node.split('.')[0])")
  if ($major -lt 20 -or $major -ge 25) { throw "Node.js $major não suportado. Use Node.js 20, 22 ou 24." }
}
function Copy-Directory([string]$Source, [string]$Destination) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Copy-Item -Path (Join-Path $Source '*') -Destination $Destination -Recurse -Force
}

$BundleRoot = Split-Path -Parent $PSScriptRoot
$EngineSource = Join-Path $BundleRoot 'engine'
$ModuleSource = Join-Path $BundleRoot 'foundry-module'
$EngineTarget = Join-Path $InstallRoot 'engine'
$ModuleTarget = Join-Path $FoundryDataPath 'modules\mestre-orc'

if (-not (Test-Path (Join-Path $EngineSource 'package.json'))) { throw 'Pacote do Engine não encontrado no bundle.' }
if (-not (Test-Path (Join-Path $ModuleSource 'module.json'))) { throw 'Pacote do módulo Foundry não encontrado no bundle.' }
Assert-Node

if (Test-Path $EngineTarget) {
  if (-not $Force) { throw "Já existe uma instalação em $InstallRoot. Use update-mestre-orc.ps1 ou execute com -Force." }
  $backup = Join-Path $InstallRoot ("previous-install-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  Write-Step "Preservando instalação anterior em $backup"
  Move-Item -Path $EngineTarget -Destination $backup
}

Write-Step 'Copiando Engine'
Copy-Directory $EngineSource $EngineTarget
if (-not (Test-Path (Join-Path $EngineTarget '.env'))) {
  Copy-Item (Join-Path $EngineTarget '.env.example') (Join-Path $EngineTarget '.env')
}

if (-not $SkipDependencies) {
  Write-Step 'Instalando dependências de produção'
  Push-Location $EngineTarget
  try { & npm ci --omit=dev --ignore-scripts }
  finally { Pop-Location }
}

Write-Step 'Executando migrações iniciais'
& node (Join-Path $EngineTarget 'scripts\migrate-data.mjs') apply --data-dir (Join-Path $EngineTarget 'data') --reason install | Out-Host

Write-Step 'Instalando módulo do Foundry'
if (Test-Path $ModuleTarget) { Remove-Item $ModuleTarget -Recurse -Force }
Copy-Directory $ModuleSource $ModuleTarget

$Launcher = @"
Set-StrictMode -Version Latest
`$ErrorActionPreference = 'Stop'
Set-Location '$EngineTarget'
& node 'apps/api/src/server.js'
"@
Set-Content -Path (Join-Path $InstallRoot 'start-mestre-orc.ps1') -Value $Launcher -Encoding UTF8

$InstallMetadata = @{
  installedAt = (Get-Date).ToString('o')
  enginePath = $EngineTarget
  modulePath = $ModuleTarget
  version = (Get-Content (Join-Path $EngineTarget 'package.json') -Raw | ConvertFrom-Json).version
} | ConvertTo-Json -Depth 4
Set-Content -Path (Join-Path $InstallRoot 'installation.json') -Value $InstallMetadata -Encoding UTF8

Write-Step 'Instalação concluída.'
Write-Host "1. Revise $EngineTarget\.env"
Write-Host "2. Execute $InstallRoot\start-mestre-orc.ps1"
Write-Host '3. Ative o módulo Mestre Orc no Foundry VTT.'
