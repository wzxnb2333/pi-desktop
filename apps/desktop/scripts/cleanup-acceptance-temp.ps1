param(
  [string]$TempRoot = [IO.Path]::GetTempPath(),
  [ValidateRange(0, 525600)][int]$MinimumAgeMinutes = 60,
  [switch]$Apply,
  [string]$ReportPath
)

$ErrorActionPreference = 'Stop'

function Test-InitialFixtureObjects([IO.FileInfo[]]$Files, [string]$RootPath) {
  # Interrupted legacy cleanup can leave only the three read-only Git objects
  # of the fixture's initial commit. Verify their content, not just their names.
  if ($Files.Count -ne 3) { return $false }
  $initialBlob = '8ccd22ad57a45848d2f13d6c236deaa8db72284d'
  $initialTree = '66a5eff4d329a5e31b5341adeff8f498fb19ea4b'
  $hashes = [Collections.Generic.List[string]]::new()
  $initialCommit = $false
  foreach ($file in $Files) {
    $relative = [IO.Path]::GetRelativePath($RootPath, $file.FullName).Replace('\', '/')
    if ($relative -cnotmatch '^project/\.git/objects/([0-9a-f]{2})/([0-9a-f]{38})$' -or $file.Length -gt 4096) { return $false }
    $expectedHash = $Matches[1] + $Matches[2]
    $inputStream = $file.OpenRead()
    $inflated = [IO.Compression.ZLibStream]::new($inputStream, [IO.Compression.CompressionMode]::Decompress)
    $output = [IO.MemoryStream]::new()
    try {
      $buffer = [byte[]]::new(4096)
      while (($read = $inflated.Read($buffer, 0, $buffer.Length)) -gt 0) {
        if ($output.Length + $read -gt 4096) { return $false }
        $output.Write($buffer, 0, $read)
      }
      $data = $output.ToArray()
    } finally {
      $output.Dispose()
      $inflated.Dispose()
      $inputStream.Dispose()
    }
    $hash = [Convert]::ToHexString([Security.Cryptography.SHA1]::HashData($data)).ToLowerInvariant()
    if ($hash -cne $expectedHash) { return $false }
    $hashes.Add($hash)
    $text = [Text.Encoding]::UTF8.GetString($data)
    if ($text -cmatch ('\Acommit [0-9]+\x00tree ' + $initialTree + '\nauthor Acceptance Test <test@example\.invalid> [0-9]+ [+-][0-9]{4}\ncommitter Acceptance Test <test@example\.invalid> [0-9]+ [+-][0-9]{4}\n\ninitial\n\z')) {
      $initialCommit = $true
    }
  }
  return $initialCommit -and $hashes.Contains($initialBlob) -and $hashes.Contains($initialTree)
}

$rootItem = Get-Item -LiteralPath $TempRoot -Force
if (-not $rootItem.PSIsContainer -or ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'TempRoot must be a regular directory, not a junction or symbolic link.'
}
$root = [IO.Path]::TrimEndingDirectorySeparator($rootItem.FullName)
$report = $null
if ($ReportPath) {
  $report = [IO.Path]::GetFullPath($ReportPath)
  if ($report.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Write the cleanup report outside TempRoot.'
  }
}
$cutoff = [DateTime]::UtcNow.AddMinutes(-$MinimumAgeMinutes)
$candidates = @(Get-ChildItem -LiteralPath $root -Directory -Force -Filter 'pi-acceptance-*')
$results = [Collections.Generic.List[object]]::new()

foreach ($candidate in $candidates) {
  $target = [IO.Path]::GetFullPath($candidate.FullName)
  $entry = [ordered]@{ path = $target; status = 'skipped'; bytes = [long]0; reason = '' }
  try {
    if ([IO.Path]::GetDirectoryName($target) -ne $root -or $candidate.Name -cnotmatch '^pi-acceptance-[A-Za-z0-9]{6}$') {
      throw 'Unexpected path or directory name.'
    }
    if ($candidate.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked directory.' }
    if ($candidate.LastWriteTimeUtc -gt $cutoff) { throw 'Recent directory.' }
    # PowerShell does not follow directory links without -FollowSymlink. Reject them altogether.
    $contents = @(Get-ChildItem -LiteralPath $target -Recurse -Force)
    if ($contents.Where({ $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Contains a junction or symbolic link.' }
    $files = @($contents | Where-Object { -not $_.PSIsContainer })
    if (Test-InitialFixtureObjects $files $target) {
      $entry.reason = 'Verified initial acceptance Git objects left by interrupted cleanup.'
    } elseif ($files.Count) {
      $project = Join-Path $target 'project'
      $fixtureHome = Join-Path $target 'home'
      foreach ($directory in @($project, $fixtureHome)) {
        $item = Get-Item -LiteralPath $directory -Force
        if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Missing or linked fixture directory.' }
      }
      $state = Get-Content -LiteralPath (Join-Path $target 'desktop.json') -Raw | ConvertFrom-Json
      $ownsProject = @($state.projects | Where-Object { $_.path -and [IO.Path]::GetFullPath($_.path) -eq $project }).Count -gt 0
      $config = Get-Content -LiteralPath (Join-Path $project '.git/config') -Raw
      if (-not $ownsProject -or $config -notmatch '(?m)^\s*name\s*=\s*Acceptance Test\s*$' -or $config -notmatch '(?m)^\s*email\s*=\s*test@example\.invalid\s*$') {
        throw 'Does not match the acceptance fixture identity.'
      }
    } else {
      $entry.reason = 'Empty temporary directory tree.'
    }
    $entry.bytes = [long](($files | Measure-Object Length -Sum).Sum)
    $entry.status = 'eligible'
    if ($Apply) {
      # Never delete a live test profile, including during another test runner's startup.
      if (Get-Process -Name electron -ErrorAction SilentlyContinue) { throw 'Electron is running; stop desktop tests before applying cleanup.' }
      $current = Get-Item -LiteralPath $target -Force
      if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -or [IO.Path]::GetDirectoryName($current.FullName) -ne $root) {
        throw 'Target changed after inspection.'
      }
      Remove-Item -LiteralPath $target -Recurse -Force
      $entry.status = 'removed'
    }
  } catch {
    $entry.status = 'skipped'
    $entry.reason = $_.Exception.Message
  }
  $results.Add([pscustomobject]$entry)
}
$removed = @($results | Where-Object status -eq 'removed')
$eligible = @($results | Where-Object status -eq 'eligible')
$summary = [ordered]@{
  root = $root
  applied = [bool]$Apply
  scanned = $candidates.Count
  removed = $removed.Count
  eligible = $eligible.Count
  skipped = @($results | Where-Object status -eq 'skipped').Count
  removedBytes = [long](($removed | Measure-Object bytes -Sum).Sum)
  eligibleBytes = [long](($eligible | Measure-Object bytes -Sum).Sum)
}
if ($report) {
  $null = New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($report)) -Force
  @{ summary = $summary; directories = $results } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $report -Encoding utf8
}
$summary | ConvertTo-Json -Compress
