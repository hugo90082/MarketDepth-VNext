param([string]$CredentialZip = 'C:\Users\hugo9\Desktop\MARKETDEPTH_FRONTEND_SUPPLEMENT_PACKAGE_2026-09-25.zip')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($CredentialZip)
try {
  $reader = [IO.StreamReader]::new($archive.GetEntry('03_BFF_ENV_LOCAL.txt').Open())
  try { $privateText = $reader.ReadToEnd() } finally { $reader.Dispose() }
} finally { $archive.Dispose() }
$env:HISTORY_READ_TOKEN = [regex]::Match($privateText, '(?m)^HISTORY_READ_TOKEN=(.+)$').Groups[1].Value.Trim().Trim('"').Trim("'")
if (-not $env:HISTORY_READ_TOKEN) { throw 'Missing token in private credential package' }
try { node scripts/local-worker.mjs } finally { Remove-Item Env:HISTORY_READ_TOKEN }
