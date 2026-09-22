#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$ExtRoot = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ExtRoot
$OpsLog = Join-Path $ProjectRoot ".agent-ops.log"

function Write-OpsLog([string]$Phase, [string]$Title, [string]$Details = "") {
  $ts = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffK")
  $line = "[$ts] $Phase | $Title | $Details"
  Add-Content -Path $OpsLog -Value $line -Encoding UTF8
  Write-Host $line
}

Set-Location $ProjectRoot
Write-OpsLog "START" "build-after-apply.ps1" ""

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ExtRoot "apply.ps1")
if ($LASTEXITCODE -ne 0) { throw "apply.ps1 failed" }

$env:GOPROXY = "https://goproxy.cn,direct"
Write-OpsLog "NOTE" "go get conpty" "github.com/UserExistsError/conpty"
go get github.com/UserExistsError/conpty@latest
go mod tidy

$outDir = Join-Path $ProjectRoot "bin"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$exe = Join-Path $outDir "Hadice.exe"
Write-OpsLog "NOTE" "go build" $exe
go build -o $exe .
if ($LASTEXITCODE -ne 0) { throw "go build failed" }

Write-OpsLog "END" "build-after-apply.ps1" "success exe=$exe size=$((Get-Item $exe).Length)"
Write-Host "BUILD OK: $exe"
