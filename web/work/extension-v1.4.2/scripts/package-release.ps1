param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$stage = Join-Path $root '.release-staging'
$release = Join-Path $root 'release'

& $node (Join-Path $root 'scripts\build.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Extension build failed' }
& $node (Join-Path $root 'scripts\build-public-release.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Public release preparation failed' }

$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $stage 'manifest.json') | ConvertFrom-Json
$fileName = "coinglass-indicator-alert-v$($manifest.version).zip"
$zipPath = Join-Path $release $fileName
New-Item -ItemType Directory -Force -Path $release | Out-Null
Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object { $_.LastWriteTimeUtc = [DateTime]'2000-01-01T00:00:00Z' }
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -CompressionLevel Optimal

$file = Get-Item -LiteralPath $zipPath
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$metadata = [ordered]@{
  version = $manifest.version
  fileName = $fileName
  sizeBytes = $file.Length
  sha256 = $hash
}
$metadataJson = $metadata | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $release 'release.json'), $metadataJson, [Text.UTF8Encoding]::new($false))
Remove-Item -LiteralPath $stage -Recurse -Force

Write-Output "Created $zipPath"
Write-Output "SHA-256 $hash"
