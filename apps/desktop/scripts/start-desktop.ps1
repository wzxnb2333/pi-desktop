param([switch]$Dev)
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
Set-Location -LiteralPath $projectRoot

if ($Dev) {
  if (-not (Test-Path -LiteralPath 'node_modules/electron/dist/electron.exe')) {
    throw 'Install dependencies first. See apps/desktop/README.md.'
  }
  npm run desktop:dev
  exit $LASTEXITCODE
}

$packagedApp = Join-Path $projectRoot '.artifacts/desktop/win-unpacked/Pi Desktop.exe'
if (Test-Path -LiteralPath $packagedApp) {
  if ($args) {
    Start-Process -FilePath $packagedApp -ArgumentList $args | Out-Null
  } else {
    Start-Process -FilePath $packagedApp | Out-Null
  }
  exit 0
}

if (-not (Test-Path -LiteralPath 'node_modules/electron/dist/electron.exe')) {
  throw 'Install dependencies first. See apps/desktop/README.md.'
}

if (-not (Test-Path -LiteralPath 'apps/desktop/out/main/index.js')) {
  npm run desktop:build
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

npm run start --workspace=@pi-desktop/app
exit $LASTEXITCODE
