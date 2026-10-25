<#
.SYNOPSIS
    Builds the MU Online Solo Classic WebAssembly Client.
    100% self-contained within the repository.
#>

param(
    [switch]$RecompileAll = $false
)

$ErrorActionPreference = "Stop"

# --- 1. Detect Emscripten SDK ---
if (-not (Get-Command emcc -ErrorAction SilentlyContinue)) {
    $cand = @()
    if ($env:EMSDK -and (Test-Path (Join-Path $env:EMSDK "emsdk_env.bat"))) { $cand += $env:EMSDK }
    $userEmsdk = Join-Path $env:USERPROFILE "emsdk"
    if (Test-Path (Join-Path $userEmsdk "emsdk_env.bat")) { $cand += $userEmsdk }
    if (Test-Path "C:\emsdk\emsdk_env.bat") { $cand += "C:\emsdk" }

    if ($cand.Count -gt 0) {
        $emsdkDir = $cand[0]
        Write-Host "Activating Emscripten SDK from $emsdkDir..." -ForegroundColor Cyan
        $envVars = & cmd.exe /c "call `"$emsdkDir\emsdk_env.bat`" >nul 2>&1 && set"
        foreach ($line in $envVars) {
            $idx = $line.IndexOf('=')
            if ($idx -gt 0) {
                $name = $line.Substring(0, $idx)
                $val = $line.Substring($idx + 1)
                [Environment]::SetEnvironmentVariable($name, $val, "Process")
            }
        }
    }
}

if (-not (Get-Command emcc -ErrorAction SilentlyContinue)) {
    Write-Error "emcc compiler not found in PATH, `$env:EMSDK, or `$env:USERPROFILE\emsdk. Please install/activate Emscripten SDK."
    exit 1
}

# --- 2. Resolve Paths (Strictly Relative to Repo) ---
$ClientDir = $PSScriptRoot
$RepoRoot = Resolve-Path (Join-Path $ClientDir "..\..")
$OutDir = Join-Path $ClientDir "out"
$ObjDir = Join-Path $OutDir "all"
$ProofDir = Join-Path $ClientDir "proof"
$DataDir = Join-Path $ClientDir "Client\Data"
$ConfigFile = Join-Path $ClientDir "Client\Config.ini"
$WebDir = Join-Path $RepoRoot "web"
$SourcesList = Join-Path $ClientDir "m2-sources.txt"

New-Item -ItemType Directory -Force -Path $ObjDir, $ProofDir, $WebDir | Out-Null

if (-not (Test-Path $DataDir)) {
    Write-Error "Client data directory not found at: $DataDir"
    exit 1
}

if (-not (Test-Path $ConfigFile)) {
    Write-Error "Config file not found at: $ConfigFile"
    exit 1
}

# --- 3. Compile Object Files if needed ---
$Includes = @(
    "-I", (Join-Path $ClientDir "browser"),
    "-I", (Join-Path $ClientDir "browser\compat"),
    "-I", (Join-Path $ClientDir "src"),
    "-I", (Join-Path $ClientDir "lib\libjpeg\jpeg-6b"),
    "-I", (Join-Path $ClientDir "lib\miniaudio")
)
$CxxFlags = @("-c", "-std=c++17", "-O2", "-ferror-limit=5", "-Wno-macro-redefined", "-Wno-ignored-attributes", "-Wno-deprecated-non-prototype", "-Wno-c++11-narrowing")
$CFlags = @("-c", "-std=c11", "-O2", "-ferror-limit=5", "-Wno-deprecated-non-prototype", "-I", (Join-Path $ClientDir "lib\libjpeg\jpeg-6b"))

if (Test-Path $SourcesList) {
    $sources = @(Get-Content $SourcesList | Where-Object { $_.Trim() -ne "" })
    $sources += @("browser/shell_login.cpp", "browser/net_ws.cpp", "browser/mu_mesh_draw.cpp")
    Write-Host "Checking $($sources.Count) source files..." -ForegroundColor Cyan
    $compiled = 0
    foreach ($rel in $sources) {
        $flat = ($rel -replace '[\\/]', '_') -replace '\.cpp$', '.o' -replace '\.c$', '.o'
        $destObj = Join-Path $ObjDir $flat
        $srcFile = Join-Path $ClientDir $rel

        if ($RecompileAll -or (-not (Test-Path $destObj)) -or ((Get-Item $srcFile).LastWriteTime -gt (Get-Item $destObj).LastWriteTime)) {
            Write-Host "  Compiling: $rel"
            if ($rel.EndsWith(".c")) {
                & emcc @CFlags $srcFile -o $destObj
            } else {
                & emcc @CxxFlags @Includes $srcFile -o $destObj
            }
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Compilation failed for $rel"
                exit 1
            }
            $compiled++
        }
    }
    if ($compiled -gt 0) {
        Write-Host "Compiled $compiled file(s)." -ForegroundColor Green
    } else {
        Write-Host "All object files up to date." -ForegroundColor Green
    }
}

# --- 4. Generate Object List for Linker ---
$objFiles = Get-ChildItem -Path $ObjDir -Filter "*.o"
if ($objFiles.Count -eq 0) {
    Write-Error "No object files found in $ObjDir to link!"
    exit 1
}

$objsTxt = Join-Path $ProofDir "login-objs.txt"
$objPaths = $objFiles | ForEach-Object { $_.FullName.Replace('\', '/') }
[IO.File]::WriteAllLines($objsTxt, $objPaths)

# --- 5. Link WebAssembly Client ---
Write-Host "Linking WebAssembly client ($($objFiles.Count) objects)..." -ForegroundColor Cyan

$outJs = Join-Path $OutDir "shell_login.js"

$linkArgs = @(
    "-std=c++17",
    "--profiling-funcs",
    "-sEMULATE_FUNCTION_POINTER_CASTS=1",
    "-ferror-limit=30",
    "-sDEFAULT_TO_CXX",
    "-Wno-macro-redefined",
    "-Wno-ignored-attributes",
    "-Wno-deprecated-non-prototype",
    "-Wno-c++11-narrowing"
) + $Includes + @(
    "@$objsTxt",
    "-o", $outJs,
    "-sLEGACY_GL_EMULATION",
    "-sGL_FFP_ONLY",
    "-sMIN_WEBGL_VERSION=2",
    "-sMAX_WEBGL_VERSION=2",
    "-sINITIAL_MEMORY=536870912",
    "-sSTACK_SIZE=8388608",
    "-sFORCE_FILESYSTEM=1",
    "-sALLOW_MEMORY_GROWTH=0",
    "-sEXPORTED_RUNTIME_METHODS=HEAPU8",
    "--preload-file", "$DataDir@/Data",
    "--preload-file", "$ConfigFile@/config.ini",
    "-Wl,--error-limit=0"
)

& emcc @linkArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Link failed!"
    exit 1
}
Write-Host "Link successful." -ForegroundColor Green

# --- 6. Patch Output HTML/JS ---
$patchScript = Join-Path $ClientDir "patch-login-page.ps1"
if (Test-Path $patchScript) {
    Write-Host "Applying WebGL patches..." -ForegroundColor Cyan
    & powershell -NoProfile -File $patchScript -Token login103
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Patching failed!"
        exit 1
    }
}

# --- 7. Deploy to web/ ---
Write-Host "Deploying build artifacts to web/..." -ForegroundColor Cyan
Copy-Item (Join-Path $OutDir "shell_login.wasm") (Join-Path $WebDir "shell_login.wasm") -Force
Copy-Item (Join-Path $OutDir "shell_login.js") (Join-Path $WebDir "shell_login.js") -Force
Copy-Item (Join-Path $OutDir "shell_login.data") (Join-Path $WebDir "shell_login.data") -Force

Write-Host "Build complete! All artifacts deployed to web/." -ForegroundColor Green
