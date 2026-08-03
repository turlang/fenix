[CmdletBinding()]
param(
  [string]$InstallRoot = "$env:LOCALAPPDATA\MestreOrc",
  [string]$FoundryDataPath = "$env:LOCALAPPDATA\FoundryVTT\Data",
  [switch]$SkipDependencies
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Write-Step([string]$Message) { Write-Host "[Mestre Orc] $Message" -ForegroundColor Cyan }
function Copy-Directory([string]$Source, [string]$Destination) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Copy-Item -Path (Join-Path $Source '*') -Destination $Destination -Recurse -Force
}

$BundleRoot = Split-Path -Parent $PSScriptRoot
$EngineSource = Join-Path $BundleRoot 'engine'
$ModuleSource = Join-Path $BundleRoot 'foundry-module'
$EngineTarget = Join-Path $InstallRoot 'engine'
$ModuleTarget = Join-Path $FoundryDataPath 'modules\mestre-orc'
$StageRoot = Join-Path $InstallRoot ('.update-stage-' + [guid]::NewGuid().ToString('N'))
$StageEngine = Join-Path $StageRoot 'engine'
$PreviousRoot = Join-Path $InstallRoot 'previous'
$PreviousEngine = Join-Path $PreviousRoot 'engine'
$PreviousModule = Join-Path $PreviousRoot 'foundry-module'

if (-not (Test-Path (Join-Path $EngineTarget 'package.json'))) { throw 'Instalação atual não encontrada. Use install-mestre-orc.ps1.' }
if (-not (Test-Path (Join-Path $EngineSource 'package.json'))) { throw 'Novo Engine não encontrado no bundle.' }

try {
  Write-Step 'Preparando nova versão em área temporária'
  Copy-Directory $EngineSource $StageEngine
  if (Test-Path (Join-Path $EngineTarget '.env')) { Copy-Item (Join-Path $EngineTarget '.env') (Join-Path $StageEngine '.env') -Force }
  if (Test-Path (Join-Path $EngineTarget 'data')) {
    Remove-Item (Join-Path $StageEngine 'data') -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Directory (Join-Path $EngineTarget 'data') (Join-Path $StageEngine 'data')
  }

  if (-not $SkipDependencies) {
    Write-Step 'Instalando dependências da nova versão'
    Push-Location $StageEngine
    try { & npm ci --omit=dev --ignore-scripts }
    finally { Pop-Location }
  }

  Write-Step 'Validando e migrando cópia dos dados'
  & node (Join-Path $StageEngine 'scripts\migrate-data.mjs') inspect --data-dir (Join-Path $StageEngine 'data') | Out-Host
  & node (Join-Path $StageEngine 'scripts\migrate-data.mjs') apply --data-dir (Join-Path $StageEngine 'data') --reason update | Out-Host
  & node (Join-Path $StageEngine 'scripts\verify-installation.mjs') --root $StageEngine --foundry-module $ModuleSource | Out-Host

  Write-Step 'Criando ponto de rollback'
  Remove-Item $PreviousRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $PreviousRoot | Out-Null
  Move-Item $EngineTarget $PreviousEngine
  if (Test-Path $ModuleTarget) { Move-Item $ModuleTarget $PreviousModule }

  Write-Step 'Ativando nova versão'
  Move-Item $StageEngine $EngineTarget
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ModuleTarget) | Out-Null
  Copy-Directory $ModuleSource $ModuleTarget
  Remove-Item $StageRoot -Recurse -Force -ErrorAction SilentlyContinue
  Write-Step 'Atualização concluída. O ponto de rollback foi preservado.'
} catch {
  Write-Host "[Mestre Orc] Atualização cancelada: $($_.Exception.Message)" -ForegroundColor Red
  if (-not (Test-Path $EngineTarget) -and (Test-Path $PreviousEngine)) { Move-Item $PreviousEngine $EngineTarget }
  if (-not (Test-Path $ModuleTarget) -and (Test-Path $PreviousModule)) { Move-Item $PreviousModule $ModuleTarget }
  Remove-Item $StageRoot -Recurse -Force -ErrorAction SilentlyContinue
  throw
}
