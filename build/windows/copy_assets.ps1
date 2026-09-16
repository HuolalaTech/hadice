[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Output,
    [Parameter(Mandatory = $true)][string]$Arch
)

$ErrorActionPreference = 'Stop'
$outputDir = Split-Path -Parent $Output
$binDir = Join-Path $outputDir 'bin'
$resourcesDir = Join-Path $outputDir 'resources'

# Rebuild bin/ from scratch so stale files from previous builds do not leak.
if (Test-Path -LiteralPath $binDir) {
    Remove-Item -LiteralPath $binDir -Recurse -Force
}
New-Item -ItemType Directory -Path $binDir -Force | Out-Null
$assetBin = Join-Path (Join-Path (Get-Location) "assets\windows\$Arch") 'bin'
if (Test-Path -LiteralPath $assetBin -PathType Container) {
    Copy-Item -Path (Join-Path $assetBin '*') -Destination $binDir -Recurse -Force
}

foreach ($abi in @('arm64-v8a', 'armeabi-v7a')) {
    $source = Join-Path (Get-Location) "agent\build\$abi\libnetwork_agent.so"
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Missing $source. Run 'wails3 task build:agent' first."
    }
    $agentDir = Join-Path $resourcesDir "agent\$abi"
    New-Item -ItemType Directory -Path $agentDir -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $agentDir -Force
}

New-Item -ItemType Directory -Path $resourcesDir -Force | Out-Null
$notices = @(
    @{ Source = 'NOTICE'; Resource = 'NOTICE'; Root = 'NOTICE' },
    @{ Source = 'assets\NOTICE'; Resource = 'THIRD_PARTY_NOTICE'; Root = 'THIRD_PARTY_NOTICE' },
    @{ Source = 'LICENSE'; Resource = 'LICENSE'; Root = 'LICENSE' }
)
foreach ($notice in $notices) {
    $source = Join-Path (Get-Location) $notice.Source
    if (Test-Path -LiteralPath $source -PathType Leaf) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $resourcesDir $notice.Resource) -Force
        Copy-Item -LiteralPath $source -Destination (Join-Path $outputDir $notice.Root) -Force
    }
}
