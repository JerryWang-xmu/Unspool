param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8080,
  [string]$DataDir = "$env:LOCALAPPDATA\Unspool\data",
  [string]$ConnectionFile = "$env:LOCALAPPDATA\Unspool\runner-connection.json",
  [string]$NodeHome = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root
$runnerUrl = "http://127.0.0.1:$Port/v1"
$entry = Join-Path $root "apps/runner-api/dist/apps/runner-api/src/index.js"

function Test-Node24([string]$Candidate) {
  if ([string]::IsNullOrWhiteSpace($Candidate) -or -not (Test-Path $Candidate -PathType Leaf)) {
    return $false
  }
  try {
    $version = & $Candidate -p "process.versions.node" 2>$null
    return $LASTEXITCODE -eq 0 -and $version.StartsWith("24.")
  } catch {
    return $false
  }
}

function Find-Node24 {
  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($NodeHome)) {
    $candidates += Join-Path $NodeHome "node.exe"
  }
  if (-not [string]::IsNullOrWhiteSpace($env:UNSPOOL_NODE_HOME)) {
    $candidates += Join-Path $env:UNSPOOL_NODE_HOME "node.exe"
  }
  $candidates += Join-Path $root "runtime/node/node.exe"
  $portableRoot = "$env:LOCALAPPDATA\Temp\opencode\node24"
  if (Test-Path $portableRoot) {
    $candidates += Get-ChildItem $portableRoot -Directory -Filter "node-v24*-win-x64" |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName "node.exe" }
  }
  $pathNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -ne $pathNode) {
    $candidates += $pathNode.Source
  }
  foreach ($candidate in $candidates) {
    if (Test-Node24 $candidate) {
      return $candidate
    }
  }
  return $null
}

$existingHealth = $null
try {
  $existingHealth = Invoke-RestMethod -Uri "$runnerUrl/health" -TimeoutSec 2
} catch {}
if ($null -ne $existingHealth -and $existingHealth.service -eq "runner-api") {
  if (Test-Path $ConnectionFile -PathType Leaf) {
    Write-Host "Unspool Runner is already available at $runnerUrl"
    Write-Host "Connection file: $ConnectionFile"
    exit 0
  }
  throw "A Runner is already listening on port $Port, but its connection file is unavailable: $ConnectionFile"
}

$nodeExe = Find-Node24
if ($null -eq $nodeExe) {
  throw "Node.js 24 x64 was not found. Install Node 24 or set UNSPOOL_NODE_HOME to its installation directory."
}
Write-Host "Using Node: $(& $nodeExe --version)"

if (-not (Test-Path $entry -PathType Leaf)) {
  if (-not (Test-Path (Join-Path $root "node_modules") -PathType Container)) {
    throw "Dependencies are missing. Run 'npm ci' once, then start the Runner again."
  }
  $npm = Join-Path (Split-Path $nodeExe -Parent) "npm.cmd"
  if (-not (Test-Path $npm -PathType Leaf)) {
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
  }
  Write-Host "Building the Runner for first use..."
  & $npm run build --workspace @unspool/runner-api
  if ($LASTEXITCODE -ne 0) {
    throw "Runner build failed with exit code $LASTEXITCODE."
  }
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $ConnectionFile -Parent) | Out-Null
$token = $null
if (Test-Path $ConnectionFile -PathType Leaf) {
  try {
    $existing = Get-Content $ConnectionFile -Raw | ConvertFrom-Json
    if ($existing.schemaVersion -eq 1 -and $existing.token.Trim().Length -ge 32) {
      $token = $existing.token
    }
  } catch {
    Write-Warning "The previous connection file could not be read; a new local token will be created."
  }
}
if ($null -eq $token) {
  $bytes = New-Object byte[] 32
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $random.GetBytes($bytes)
  } finally {
    $random.Dispose()
  }
  $token = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}
$connection = @{
  schemaVersion = 1
  runnerUrl = $runnerUrl
  token = $token
  updatedAt = [DateTime]::UtcNow.ToString("o")
} | ConvertTo-Json
$temporaryConnection = "$ConnectionFile.tmp"
[System.IO.File]::WriteAllText(
  $temporaryConnection,
  $connection,
  (New-Object System.Text.UTF8Encoding($false))
)
Move-Item $temporaryConnection $ConnectionFile -Force

$env:NODE_ENV = "development"
$env:HOST = "127.0.0.1"
$env:PORT = [string]$Port
$env:UNSPOOL_DATA_DIR = $DataDir
$env:UNSPOOL_OWNER_TOKEN = $token
$env:UNSPOOL_MODEL_PROVIDER = "faux"
$env:UNSPOOL_BETA_ENABLED = "false"

Write-Host ""
Write-Host "Unspool Runner: $runnerUrl"
Write-Host "Data directory: $DataDir"
Write-Host "Connection file: $ConnectionFile"
Write-Host "The desktop client reads this file automatically; no token is embedded in the EXE."
Write-Host "Keep this window open. Press Ctrl+C to stop the Runner."
Write-Host ""
& $nodeExe $entry
exit $LASTEXITCODE
