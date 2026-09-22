#Requires -Version 5.1
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$ExtRoot = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ExtRoot
$Backend = Join-Path $ProjectRoot "backend"
$OpsLog = Join-Path $ProjectRoot ".agent-ops.log"
$BackupDir = Join-Path $ExtRoot ".backup"
$AppliedMarker = Join-Path $ExtRoot ".applied"
$DstShell = Join-Path $Backend "shell.go"
$DstShellWin = Join-Path $Backend "shell_windows.go"
$BakShell = Join-Path $BackupDir "shell.go"
$BakShellWin = Join-Path $BackupDir "shell_windows.go"

function Write-OpsLog([string]$Phase, [string]$Title, [string]$Details = "") {
  $ts = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffK")
  $line = "[$ts] $Phase | $Title | $Details"
  Add-Content -Path $OpsLog -Value $line -Encoding UTF8
  Write-Host $line
}

Write-OpsLog "START" "revert.ps1" "project=$ProjectRoot"

if (-not (Test-Path $BakShell)) {
  Write-OpsLog "NOTE" "revert abort" "no backup at $BakShell"
  throw "No backup found. Nothing to revert (or apply was never run)."
}

Copy-Item -Force $BakShell $DstShell
Write-OpsLog "NOTE" "restored shell.go" $DstShell

if (Test-Path $BakShellWin) {
  Copy-Item -Force $BakShellWin $DstShellWin
  Write-OpsLog "NOTE" "restored shell_windows.go" $DstShellWin
} else {
  if (Test-Path $DstShellWin) {
    Remove-Item -Force $DstShellWin
    Write-OpsLog "NOTE" "removed shell_windows.go" $DstShellWin
  }
}

$winshell = Join-Path $Backend "winshell"
if (Test-Path $winshell) {
  Remove-Item -Recurse -Force $winshell
  Write-OpsLog "NOTE" "removed winshell dir" $winshell
}

if (Test-Path $AppliedMarker) {
  Remove-Item -Force $AppliedMarker
  Write-OpsLog "NOTE" "removed .applied marker" ""
}

Write-OpsLog "END" "revert.ps1" "success"
Write-Host "REVERT OK."
