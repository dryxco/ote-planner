# Windows: makes sure a Node.js 20.9+ is there (downloads the official one into Ote's folder if
# not, checked against nodejs.org's published checksums), then runs scripts\install.mjs.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")
$base = if ($env:OTE_INSTALL_BASE) { $env:OTE_INSTALL_BASE } else { Join-Path $env:LOCALAPPDATA "Ote" }
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }

function New-Enough($exe) {
  try { & $exe -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=9)?0:1)'; return $LASTEXITCODE -eq 0 } catch { return $false }
}

$node = $null
$bundled = Join-Path $base "runtime\node.exe"
if ((Test-Path $bundled) -and (New-Enough $bundled)) { $node = $bundled }
else {
  $sys = Get-Command node -ErrorAction SilentlyContinue
  if ($sys -and (New-Enough $sys.Source)) { $node = $sys.Source }
}
if (-not $node) {
  Write-Host "> Getting Node.js (the engine Ote runs on)"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $dist = "https://nodejs.org/dist/latest-v24.x"
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("sync-node-" + [guid]::NewGuid())
  New-Item -ItemType Directory $tmp | Out-Null
  $sums = (Invoke-WebRequest "$dist/SHASUMS256.txt" -UseBasicParsing).Content -split "`n"
  $line = $sums | Where-Object { $_ -match " node-v[0-9.]+-win-$arch\.zip$" } | Select-Object -First 1
  if (-not $line) { throw "No Node.js download for win-$arch" }
  $hash, $file = $line.Trim() -split "\s+"
  Invoke-WebRequest "$dist/$file" -OutFile (Join-Path $tmp $file) -UseBasicParsing
  if ((Get-FileHash (Join-Path $tmp $file) -Algorithm SHA256).Hash.ToLower() -ne $hash) { throw "The Node.js download is damaged (checksum mismatch). Try again." }
  Expand-Archive (Join-Path $tmp $file) -DestinationPath $tmp
  $runtime = Join-Path $base "runtime"
  if (Test-Path $runtime) { Remove-Item $runtime -Recurse -Force }
  New-Item -ItemType Directory $base -Force | Out-Null
  Move-Item (Join-Path $tmp ($file -replace "\.zip$", "")) $runtime
  Remove-Item $tmp -Recurse -Force
  $node = $bundled
}
$env:PATH = (Split-Path $node) + ";" + $env:PATH
& $node scripts\install.mjs @args
exit $LASTEXITCODE
