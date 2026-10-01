param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
$stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
try {
  [Console]::WriteLine('LOCK_READY')
  [Console]::Out.Flush()
  [void][Console]::ReadLine()
} finally {
  $stream.Dispose()
}
