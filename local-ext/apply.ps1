#Requires -Version 5.1
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ExtRoot = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ExtRoot
$Backend = Join-Path $ProjectRoot "backend"
$OpsLog = Join-Path $ProjectRoot ".agent-ops.log"
$BackupDir = Join-Path $ExtRoot ".backup"
$AppliedMarker = Join-Path $ExtRoot ".applied"
$SrcShellWin = Join-Path $ExtRoot "src\backend\shell_windows.go"
$DstShell = Join-Path $Backend "shell.go"
$DstShellWin = Join-Path $Backend "shell_windows.go"

function Write-OpsLog([string]$Phase, [string]$Title, [string]$Details = "") {
  $ts = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffK")
  $line = "[$ts] $Phase | $Title | $Details"
  Add-Content -Path $OpsLog -Value $line -Encoding UTF8
  Write-Host $line
}

Write-OpsLog "START" "apply.ps1" "project=$ProjectRoot"

if (-not (Test-Path $DstShell)) { throw "Missing official backend\shell.go: $DstShell" }
if (-not (Test-Path $SrcShellWin)) { throw "Missing extension source: $SrcShellWin" }

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$already = Test-Path $AppliedMarker
if (-not $already) {
  Copy-Item -Force $DstShell (Join-Path $BackupDir "shell.go")
  if (Test-Path $DstShellWin) {
    Copy-Item -Force $DstShellWin (Join-Path $BackupDir "shell_windows.go")
  }
  Write-OpsLog "NOTE" "backup refreshed" "shell.go (+ shell_windows.go if present)"
} else {
  Write-OpsLog "NOTE" "already applied" "keeping existing .backup; re-copying sources"
}

$shellText = Get-Content -Raw -Encoding UTF8 $DstShell
$buildTag = "//go:build !windows"
if ($shellText -notmatch '(?m)^//go:build\s+!windows\s*$') {
  if ($shellText -match '(?m)^//go:build[^\r\n]*') {
    $shellText = [regex]::Replace($shellText, '(?m)^//go:build[^\r\n]*\r?\n(?:^// \+build[^\r\n]*\r?\n)?', ($buildTag + "`r`n`r`n"), 1)
  } else {
    $shellText = $buildTag + "`r`n`r`n" + $shellText
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText($DstShell, $shellText, $utf8NoBom)
  Write-OpsLog "NOTE" "patched shell.go" "added //go:build !windows"
} else {
  Write-OpsLog "NOTE" "shell.go build tag" "already has //go:build !windows"
}

Copy-Item -Force $SrcShellWin $DstShellWin
Write-OpsLog "NOTE" "copied shell_windows.go" $DstShellWin

$stamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffK")
@(
  "applied_at=$stamp"
  "files:"
  "backend\shell.go"
  "backend\shell_windows.go"
) | Set-Content -Path $AppliedMarker -Encoding UTF8
Write-OpsLog "END" "apply.ps1" "success"
Write-Host "APPLY OK. Marker: $AppliedMarker"
