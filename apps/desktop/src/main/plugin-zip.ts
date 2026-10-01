import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
// Only this application-owned script executes. ZIP paths enter through environment variables.
// Validation follows .NET's ZipArchive guidance: owned destination, bounded entries, no links.
const unpackScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($env:PI_PLUGIN_ARCHIVE)
try {
  $root = [System.IO.Path]::GetFullPath($env:PI_PLUGIN_DESTINATION).TrimEnd([char]92) + [char]92
  if ($archive.Entries.Count -gt 5000) { throw 'ZIP entry limit exceeded' }
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
  [long]$total = 0
  $entries = @()
  foreach ($entry in $archive.Entries) {
    $name = $entry.FullName.Replace([char]92, [char]47)
    $directory = $name.EndsWith('/')
    $parts = $name.TrimEnd([char]47).Split([char]47)
    if ($parts.Count -eq 0 -or $name.StartsWith('/') -or $name -match '[\x00-\x1f:*?"<>|]') { throw 'Invalid ZIP entry path' }
    foreach ($part in $parts) {
      if (!$part -or $part -eq '.' -or $part -eq '..' -or $part -match '[. ]$' -or $part -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') { throw 'Invalid ZIP entry path' }
    }
    $mode = ($entry.ExternalAttributes -shr 16) -band 61440
    if (($mode -ne 0 -and $mode -ne 32768 -and $mode -ne 16384) -or ($entry.ExternalAttributes -band 1024)) { throw 'ZIP links are not supported' }
    $path = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $name))
    if (!$path.StartsWith($root, [System.StringComparison]::Ordinal) -or !$seen.Add($path)) { throw 'Duplicate or escaping ZIP entry' }
    $total += $entry.Length
    if ($entry.Length -gt 52428800 -or $total -gt 209715200 -or ($directory -and $entry.Length -ne 0)) { throw 'ZIP size limit exceeded' }
    $entries += @{ Entry = $entry; Path = $path; Directory = $directory }
  }
  [long]$copied = 0
  $buffer = New-Object byte[] 65536
  foreach ($item in $entries) {
    if ($item.Directory) { [void][System.IO.Directory]::CreateDirectory($item.Path); continue }
    [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($item.Path))
    $inputStream = $item.Entry.Open()
    try {
      $outputStream = [System.IO.File]::Open($item.Path, [System.IO.FileMode]::CreateNew)
      try {
        [long]$entryBytes = 0
        while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
          $entryBytes += $count; $copied += $count
          if ($entryBytes -gt $item.Entry.Length -or $copied -gt 209715200) { throw 'ZIP expanded size limit exceeded' }
          $outputStream.Write($buffer, 0, $count)
        }
        if ($entryBytes -ne $item.Entry.Length) { throw 'Truncated ZIP entry' }
      } finally { $outputStream.Dispose() }
    } finally { $inputStream.Dispose() }
  }
} finally { $archive.Dispose() }
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;

export async function unpackPluginZip(source: string, destination: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  try {
    await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(unpackScript, 'utf16le').toString('base64')], {
      env: { ...process.env, PI_PLUGIN_ARCHIVE: source, PI_PLUGIN_DESTINATION: destination },
      windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024, signal,
    });
  } catch (error) {
    signal.throwIfAborted();
    const detail = (error as { stderr?: string }).stderr?.trim();
    throw new Error('无法解压插件归档：' + (detail || (error as NodeJS.ErrnoException).code || 'ZIP'));
  }
}
