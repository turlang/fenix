param(
  [Parameter(Mandatory=$true)]
  [string]$EnvFile,
  [switch]$RequirePixelStreamingInfra
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$envPath = Resolve-Path $EnvFile

Get-Content $envPath | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith('#')) { return }
  $parts = $line.Split('=', 2)
  if ($parts.Count -ne 2) { throw "Linha inválida no env: $line" }
  [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), 'Process')
}

Push-Location $repoRoot
try {
  $preflightArgs = @('scripts/fenix3d-gpu-preflight.mjs', '--runtime')
  if ($RequirePixelStreamingInfra) { $preflightArgs += '--infra' }
  & node @preflightArgs
  if ($LASTEXITCODE -ne 0) { throw 'GPU preflight falhou.' }

  Write-Host '[Fênix] Iniciando Render Node GPU...'
  & node 'apps/render-node/src/server.js'
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
