# Compiles NetworkHookHelper.java to DEX and embeds it in a C++ header.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot
$buildTmp = Join-Path $scriptDir 'build\helper_tmp'
$classesDir = Join-Path $buildTmp 'classes'
$outHeader = Join-Path $scriptDir 'include\helper_dex.h'

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Command"
    }
}

function Find-JdkTool {
    param([Parameter(Mandatory = $true)][string]$Name)

    if ($env:JAVA_HOME) {
        $candidate = Join-Path $env:JAVA_HOME "bin\$Name.exe"
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }
    $command = Get-Command "$Name.exe" -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    throw "$Name.exe was not found. Set JAVA_HOME to a JDK installation."
}

if (-not $env:ANDROID_HOME) {
    $androidHomeCandidates = @()
    if ($env:LOCALAPPDATA) {
        $androidHomeCandidates += Join-Path $env:LOCALAPPDATA 'Android\Sdk'
    }
    $androidHomeCandidates += 'D:\AndroidSDK'
    foreach ($candidate in $androidHomeCandidates) {
        if (Test-Path -LiteralPath $candidate -PathType Container) {
            $env:ANDROID_HOME = $candidate
            break
        }
    }
}
if (-not $env:ANDROID_HOME) {
    throw 'Android SDK was not found. Install it with Android Studio, or set ANDROID_HOME.'
}

$androidJar = $null
foreach ($api in 35..26) {
    $candidate = Join-Path $env:ANDROID_HOME "platforms\android-$api\android.jar"
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        $androidJar = $candidate
        break
    }
}
if (-not $androidJar) {
    throw 'android.jar was not found. Install an Android SDK platform from API 26 through 35.'
}

$buildToolsRoot = Join-Path $env:ANDROID_HOME 'build-tools'
$d8 = $null
if (Test-Path -LiteralPath $buildToolsRoot -PathType Container) {
    foreach ($directory in (Get-ChildItem -LiteralPath $buildToolsRoot -Directory | Sort-Object Name -Descending)) {
        foreach ($filename in @('d8.bat', 'd8.cmd', 'd8.exe')) {
            $candidate = Join-Path $directory.FullName $filename
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                $d8 = $candidate
                break
            }
        }
        if ($d8) { break }
    }
}
if (-not $d8) {
    throw 'd8 was not found. Install Android SDK Build-Tools.'
}

$javac = Find-JdkTool -Name 'javac'
$jar = Find-JdkTool -Name 'jar'

if (Test-Path -LiteralPath $buildTmp) {
    Remove-Item -LiteralPath $buildTmp -Recurse -Force
}
New-Item -ItemType Directory -Path $classesDir -Force | Out-Null

$javaSources = @(
    (Join-Path $scriptDir 'java\com\hadice\agent\NetworkHookHelper.java'),
    (Join-Path $scriptDir 'java_stub\org\chromium\net\UrlRequest.java'),
    (Join-Path $scriptDir 'java_stub\org\chromium\net\UrlResponseInfo.java'),
    (Join-Path $scriptDir 'java_stub\org\chromium\net\CronetException.java'),
    (Join-Path $scriptDir 'java_stub\org\chromium\net\UploadDataProvider.java'),
    (Join-Path $scriptDir 'java_stub\org\chromium\net\UploadDataSink.java'),
    (Join-Path $scriptDir 'java\com\hadice\agent\GnetCronetCaptureCallback.java'),
    (Join-Path $scriptDir 'java_stub\gnet\android\org\chromium\net\UrlRequest.java'),
    (Join-Path $scriptDir 'java_stub\gnet\android\org\chromium\net\ExperimentalUrlRequest.java'),
    (Join-Path $scriptDir 'java_stub\gnet\android\org\chromium\net\UrlResponseInfo.java'),
    (Join-Path $scriptDir 'java_stub\gnet\android\org\chromium\net\CronetException.java')
)

Write-Host "Using android.jar: $androidJar"
Write-Host "Using d8: $d8"
Write-Host 'Compiling Java...'
Invoke-NativeCommand -Command $javac -Arguments (@('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-cp', $androidJar, '-d', $classesDir) + $javaSources)

$stubJar = Join-Path $buildTmp 'cronet-api-stubs.jar'
Invoke-NativeCommand -Command $jar -Arguments @('cf', $stubJar, '-C', $classesDir, 'org/chromium/net', '-C', $classesDir, 'gnet/android/org/chromium/net')

$helperClasses = Get-ChildItem -LiteralPath (Join-Path $classesDir 'com\hadice\agent') -Filter '*.class' -File |
    ForEach-Object FullName
if (-not $helperClasses) {
    throw 'javac did not produce the helper class files.'
}

Write-Host 'Converting to DEX...'
Invoke-NativeCommand -Command $d8 -Arguments (@('--min-api', '26', '--classpath', $stubJar, '--output', $buildTmp) + $helperClasses)

$dexFile = Join-Path $buildTmp 'classes.dex'
if (-not (Test-Path -LiteralPath $dexFile -PathType Leaf)) {
    throw 'D8 did not produce classes.dex.'
}

$dexBytes = [IO.File]::ReadAllBytes($dexFile)
$builder = New-Object Text.StringBuilder
[void]$builder.AppendLine('#ifndef HELPER_DEX_H')
[void]$builder.AppendLine('#define HELPER_DEX_H')
[void]$builder.AppendLine()
[void]$builder.AppendLine('#include <cstdint>')
[void]$builder.AppendLine('#include <cstddef>')
[void]$builder.AppendLine()
[void]$builder.AppendLine('namespace network_agent {')
[void]$builder.AppendLine()
[void]$builder.AppendLine('static const uint8_t HELPER_DEX_BYTES[] = {')
for ($index = 0; $index -lt $dexBytes.Length; $index += 12) {
    $last = [Math]::Min($index + 11, $dexBytes.Length - 1)
    $values = for ($cursor = $index; $cursor -le $last; $cursor++) {
        '0x{0:x2}' -f $dexBytes[$cursor]
    }
    [void]$builder.Append('  ')
    [void]$builder.Append(($values -join ', '))
    [void]$builder.AppendLine(',')
}
[void]$builder.AppendLine('};')
[void]$builder.AppendLine()
[void]$builder.AppendLine('static const size_t HELPER_DEX_SIZE = sizeof(HELPER_DEX_BYTES);')
[void]$builder.AppendLine()
[void]$builder.AppendLine('}')
[void]$builder.AppendLine()
[void]$builder.AppendLine('#endif')

$utf8WithoutBom = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($outHeader, $builder.ToString(), $utf8WithoutBom)
Write-Host "Generated: $outHeader ($($dexBytes.Length) bytes)"

Remove-Item -LiteralPath $buildTmp -Recurse -Force
