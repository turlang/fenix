[CmdletBinding()]
param(
  [string]$InstallRoot = "$env:LOCALAPPDATA\MestreOrc",
  [string]$FoundryDataPath = "$env:LOCALAPPDATA\FoundryVTT\Data"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$EngineTarget = Join-Path $InstallRoot 'engine'
$ModuleTarget = Join-Path $FoundryDataPath 'modules\mestre-orc'
$PreviousRoot = Join-Path $InstallRoot 'previous'
$PreviousEngine = Join-Path $PreviousRoot 'engine'
$PreviousModule = Join-Path $PreviousRoot 'foundry-module'
if (-not (Test-Path $PreviousEngine)) { throw 'Nenhum ponto de rollback está disponível.' }
$FailedRoot = Join-Path $InstallRoot ('failed-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $FailedRoot | Out-Null
if (Test-Path $EngineTarget) { Move-Item $EngineTarget (Join-Path $FailedRoot 'engine') }
if (Test-Path $ModuleTarget) { Move-Item $ModuleTarget (Join-Path $FailedRoot 'foundry-module') }
Move-Item $PreviousEngine $EngineTarget
if (Test-Path $PreviousModule) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ModuleTarget) | Out-Null
  Move-Item $PreviousModule $ModuleTarget
}
Write-Host '[Mestre Orc] Rollback concluído.' -ForegroundColor Green
