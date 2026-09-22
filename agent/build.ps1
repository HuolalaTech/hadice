# Builds the Android JVMTI agent natively on Windows (no WSL required).
[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel')]
    [string]$BuildType = 'Release'
)

$ErrorActionPreference = 'Stop'
$scriptDir = $PSScriptRoot
$buildDir = Join-Path $scriptDir 'build'

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

function Find-AndroidCMake {
    $command = Get-Command cmake.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    if ($env:ANDROID_HOME) {
        $cmakeRoot = Join-Path $env:ANDROID_HOME 'cmake'
        if (Test-Path -LiteralPath $cmakeRoot -PathType Container) {
            $candidate = Get-ChildItem -LiteralPath $cmakeRoot -Directory |
                Sort-Object Name -Descending |
                ForEach-Object { Join-Path $_.FullName 'bin\cmake.exe' } |
                Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
                Select-Object -First 1
            if ($candidate) {
                return $candidate
            }
        }
    }

    throw 'CMake was not found. Install it with Android Studio SDK Tools or add cmake.exe to PATH.'
}

function Find-Ninja {
    param([Parameter(Mandatory = $true)][string]$CMakePath)

    $command = Get-Command ninja.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidate = Join-Path (Split-Path -Parent $CMakePath) 'ninja.exe'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        return $candidate
    }

    throw 'Ninja was not found. Install CMake through Android Studio SDK Tools or add ninja.exe to PATH.'
}

function Build-AndroidAbi {
    param(
        [Parameter(Mandatory = $true)][string]$Abi,
        [Parameter(Mandatory = $true)][string]$OutputDirectory,
        [Parameter(Mandatory = $true)][string]$ClangPath,
        [Parameter(Mandatory = $true)][string]$AndroidNdkPath
    )

    $target = if ($Abi -eq 'arm64-v8a') { 'aarch64-none-linux-android26' } else { 'armv7a-none-linux-androideabi26' }
    $sysroot = Join-Path $AndroidNdkPath 'toolchains\llvm\prebuilt\windows-x86_64\sysroot'
    $androidInclude = Join-Path $sysroot 'usr\include'
    $androidJniHeader = Join-Path $androidInclude 'jni.h'
    $compatHeader = Join-Path $scriptDir 'include\android_jni_compat.h'
    $objectDirectory = Join-Path $OutputDirectory 'manual-objects'
    New-Item -ItemType Directory -Path $objectDirectory -Force | Out-Null

    $common = @(
        "--target=$target",
        "--gcc-toolchain=$(Join-Path $AndroidNdkPath 'toolchains\llvm\prebuilt\windows-x86_64')",
        "--sysroot=$sysroot",
        '-DANDROID',
        '-fdata-sections',
        '-ffunction-sections',
        '-funwind-tables',
        '-fstack-protector-strong',
        '-no-canonical-prefixes',
        '-fno-addrsig',
        '-Wa,--noexecstack',
        '-Wformat',
        '-Werror=format-security',
        '-O2',
        '-DNDEBUG',
        '-fPIC',
        '-std=gnu++1z',
        '-include', $androidJniHeader,
        '-include', $compatHeader,
        '-I', (Join-Path $scriptDir 'include'),
        '-I', $androidInclude,
        '-I', (Join-Path $env:JAVA_HOME 'include')
    )
    $sources = @(
        'agent.cpp',
        'jvmti_utils.cpp',
        'class_transformer.cpp',
        'socket_client.cpp',
        'json_serializer.cpp',
        'bytecode_transformer.cpp'
    )
    $objects = @()
    foreach ($sourceName in $sources) {
        $source = Join-Path $scriptDir "src\$sourceName"
        $object = Join-Path $objectDirectory ($sourceName -replace '\.cpp$', '.o')
        Invoke-NativeCommand -Command $ClangPath -Arguments @($common + @('-c', $source, '-o', $object))
        $objects += $object
    }

    $output = Join-Path $OutputDirectory 'libnetwork_agent.so'
    $linkArguments = @($common + @(
        '-shared',
        '-Wl,--exclude-libs,libgcc.a',
        '-Wl,--exclude-libs,libatomic.a',
        '-static-libstdc++',
        '-Wl,--build-id',
        '-Wl,--warn-shared-textrel',
        '-Wl,--fatal-warnings',
        '-Wl,--no-undefined',
        '-Qunused-arguments',
        '-Wl,-z,noexecstack',
        '-Wl,-soname,libnetwork_agent.so',
        '-o', $output
    ) + $objects + @('-llog', '-landroid', '-latomic', '-lm'))
    Invoke-NativeCommand -Command $ClangPath -Arguments $linkArguments
    return $output
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

if (-not $env:JAVA_HOME) {
    $javacCommand = Get-Command javac.exe -ErrorAction SilentlyContinue
    if ($javacCommand) {
        $env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $javacCommand.Source)
    }
}

if ($env:ANDROID_NDK_HOME) {
    $androidNdk = $env:ANDROID_NDK_HOME
} elseif ($env:ANDROID_HOME) {
    $preferredNdk = Join-Path $env:ANDROID_HOME 'ndk\25.2.9519653'
    if (Test-Path -LiteralPath $preferredNdk -PathType Container) {
        $androidNdk = $preferredNdk
    } else {
        $ndkRoot = Join-Path $env:ANDROID_HOME 'ndk'
        if (Test-Path -LiteralPath $ndkRoot -PathType Container) {
            $androidNdk = Get-ChildItem -LiteralPath $ndkRoot -Directory |
                Sort-Object Name -Descending |
                Select-Object -First 1 -ExpandProperty FullName
        }
    }
} else {
    throw 'Android SDK was not found. Install it with Android Studio, or set ANDROID_HOME.'
}

if (-not $androidNdk -or -not (Test-Path -LiteralPath $androidNdk -PathType Container)) {
    throw 'Android NDK was not found. Install NDK 25.2.9519653 with Android Studio SDK Manager, or set ANDROID_NDK_HOME.'
}
if (-not $env:JAVA_HOME) {
    throw 'JAVA_HOME is not set. Point it to a JDK installation.'
}

$toolchain = Join-Path $androidNdk 'build\cmake\android.toolchain.cmake'
if (-not (Test-Path -LiteralPath $toolchain -PathType Leaf)) {
    throw "Android NDK toolchain was not found at $toolchain."
}

$cmake = Find-AndroidCMake
$ninja = Find-Ninja -CMakePath $cmake
$clang = Join-Path $androidNdk 'toolchains\llvm\prebuilt\windows-x86_64\bin\clang++.exe'
if (-not (Test-Path -LiteralPath $clang -PathType Leaf)) {
    throw "Android Clang was not found at $clang."
}
$jobs = [Math]::Max(1, [Environment]::ProcessorCount)

Write-Host "Using NDK: $androidNdk"
Write-Host "Using CMake: $cmake"
Write-Host "Using Ninja: $ninja"

Write-Host '=========================================='
Write-Host 'Building Helper DEX'
Write-Host '=========================================='
& (Join-Path $scriptDir 'build_helper.ps1')

foreach ($abi in @('arm64-v8a', 'armeabi-v7a')) {
    Write-Host "Building for $abi..."
    $archBuildDir = Join-Path $buildDir $abi
    New-Item -ItemType Directory -Path $archBuildDir -Force | Out-Null

    # CMake 3.10 can leave an incomplete compiler-test directory after an
    # interrupted configure. It is safe to recreate this generated directory.
    $cmakeTmpDir = Join-Path $archBuildDir 'CMakeFiles\CMakeTmp'
    if (Test-Path -LiteralPath $cmakeTmpDir) {
        Remove-Item -LiteralPath $cmakeTmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    $configureArguments = @(
        $scriptDir,
        "-DANDROID_ABI=$abi",
        '-DANDROID_PLATFORM=android-26',
        "-DANDROID_NDK_ROOT=$androidNdk",
        "-DCMAKE_BUILD_TYPE=$BuildType",
        "-DCMAKE_TOOLCHAIN_FILE=$toolchain",
        '-DANDROID_STL=c++_static',
        "-DCMAKE_MAKE_PROGRAM=$ninja",
        '-G', 'Ninja'
    )
    Push-Location $archBuildDir
    try {
        Invoke-NativeCommand -Command $cmake -Arguments $configureArguments
    } finally {
        Pop-Location
    }

    $output = Join-Path $archBuildDir 'libnetwork_agent.so'
    if ((Test-Path -LiteralPath $output -PathType Leaf) -and
        ((Get-Item -LiteralPath $output).Length -eq 0)) {
        Remove-Item -LiteralPath $output -Force
    }

    # CMake 3.10's Ninja launcher can block on cmd.exe in some Windows
    # environments. Compile and link with the NDK Clang driver directly after
    # CMake has validated the Android toolchain, keeping this path WSL-free.
    $builtOutput = Build-AndroidAbi -Abi $abi -OutputDirectory $archBuildDir -ClangPath $clang -AndroidNdkPath $androidNdk
    if (-not (Test-Path -LiteralPath $builtOutput -PathType Leaf)) {
        throw "Build completed without producing $builtOutput."
    }
    Write-Host "Built: $builtOutput"
}

Write-Host '=========================================='
Write-Host 'Build complete!'
Write-Host '=========================================='
