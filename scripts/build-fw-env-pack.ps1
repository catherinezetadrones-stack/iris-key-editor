<#
.SYNOPSIS
  Builds the Iris Key Editor firmware build-environment pack (iris-fw-env-vN.zip).

.DESCRIPTION
  Stages a trimmed copy of QMK MSYS2 (ARM toolchain only) plus a snapshot of the
  local vial-qmk working tree (including uncommitted modifications), then zips it
  into a pack the app installs via Firmware -> Install build environment.

  Pack layout:
    manifest.json     version / created / vial-qmk commit + dirty file list
    toolchain\        trimmed QMK_MSYS (usr, mingw64, etc, opt\qmk minus avr+riscv)
    vial-qmk\         source snapshot (no .git, only keebio keyboards, no lvgl/docs)
    bin\              dfu-util.exe, zadig.exe

.EXAMPLE
  .\build-fw-env-pack.ps1 -Validate
    Stages, runs a test compile against the staged tree, then zips.
#>
param(
    [string]$QmkMsysRoot = 'C:\QMK_MSYS',
    [string]$VialQmkRoot = "$env:USERPROFILE\vial-qmk",
    [string]$OutputDir   = "$PSScriptRoot\..\fw-env-pack",
    [int]   $PackVersion = 1,
    [string]$DfuUtil     = '',     # path to dfu-util.exe; auto-detected if empty
    [string]$Zadig       = "$env:USERPROFILE\Downloads\zadig-2.9.exe",  # driver-install GUI
    [switch]$Validate,             # test-compile the staged tree before zipping
    [switch]$SkipZip               # stage (and optionally validate) only
)

$ErrorActionPreference = 'Stop'

function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }
function Info($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

# Robocopy exit codes 0-7 are success; 8+ are failures.
function Copy-Tree($src, $dst, [string[]]$xd = @(), [string[]]$xf = @()) {
    $rcArgs = @($src, $dst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:2')
    if ($xd.Count) { $rcArgs += '/XD'; $rcArgs += $xd }
    if ($xf.Count) { $rcArgs += '/XF'; $rcArgs += $xf }
    & robocopy @rcArgs | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail "robocopy failed ($LASTEXITCODE): $src -> $dst" }
}

function Get-DirSizeMB($path) {
    if (-not (Test-Path $path)) { return 0 }
    [math]::Round((Get-ChildItem $path -Recurse -File -Force -ErrorAction SilentlyContinue |
        Measure-Object Length -Sum).Sum / 1MB)
}

function Windows-ToMsysPath($path) {
    $full = (Resolve-Path $path).Path
    $drive = $full.Substring(0, 1).ToLower()
    "/$drive/" + $full.Substring(3).Replace('\', '/')
}

# ── Preflight ─────────────────────────────────────────────────────────────────

if (-not (Test-Path "$QmkMsysRoot\usr\bin\bash.exe")) { Fail "QMK MSYS not found at $QmkMsysRoot" }
if (-not (Test-Path "$VialQmkRoot\Makefile"))         { Fail "vial-qmk not found at $VialQmkRoot" }

if (-not $DfuUtil) {
    $candidates = @(
        "$PSScriptRoot\..\src-tauri\binaries\dfu-util.exe",
        "$PSScriptRoot\vendor\dfu-util.exe",
        (Get-Command dfu-util.exe -ErrorAction SilentlyContinue).Source
    )
    $DfuUtil = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if ($Zadig -and -not (Test-Path $Zadig)) { $Zadig = '' }
if (-not $DfuUtil) { Write-Warning 'dfu-util.exe not found - pack will not include it (flashing falls back to system dfu-util).' }
if (-not $Zadig)   { Write-Warning 'Zadig not found - pack will not include it (driver install stays manual).' }

$OutputDir = (New-Item -ItemType Directory -Force $OutputDir).FullName
$stage = Join-Path $OutputDir 'stage'
if (Test-Path $stage) { Info "Removing previous stage"; Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null

# ── Stage toolchain ───────────────────────────────────────────────────────────

Info "Staging toolchain from $QmkMsysRoot (this copies several GB)"
Copy-Tree "$QmkMsysRoot\usr"     "$stage\toolchain\usr"
Copy-Tree "$QmkMsysRoot\mingw64" "$stage\toolchain\mingw64"
Copy-Tree "$QmkMsysRoot\etc"     "$stage\toolchain\etc"
Copy-Tree "$QmkMsysRoot\opt"     "$stage\toolchain\opt" -xd @(
    "$QmkMsysRoot\opt\qmk\avr",
    "$QmkMsysRoot\opt\qmk\riscv32-unknown-elf"
)
# MSYS expects /home and /tmp to exist; keep them empty so nothing leaks from this machine.
New-Item -ItemType Directory -Force "$stage\toolchain\home", "$stage\toolchain\tmp" | Out-Null

# ── Stage vial-qmk snapshot ───────────────────────────────────────────────────

Info "Staging vial-qmk snapshot from $VialQmkRoot"
# Bare-name /XD excludes apply at any depth: .git/.github/docs/lvgl/.build anywhere.
# keyboards is excluded wholesale, then only keebio is copied back in.
Copy-Tree $VialQmkRoot "$stage\vial-qmk" `
    -xd @('.git', '.github', '.vscode', 'docs', 'lvgl', '.build', "$VialQmkRoot\keyboards") `
    -xf @('.git')   # submodule .git pointer files are dead without the parent repo
Copy-Tree "$VialQmkRoot\keyboards\keebio" "$stage\vial-qmk\keyboards\keebio" -xd @('.git') -xf @('.git')

# ── Stage flash/driver tools ──────────────────────────────────────────────────

New-Item -ItemType Directory -Force "$stage\bin" | Out-Null
if ($DfuUtil) { Copy-Item $DfuUtil "$stage\bin\dfu-util.exe"; Info "Included dfu-util: $DfuUtil" }
if ($Zadig)   { Copy-Item $Zadig   "$stage\bin\zadig.exe";    Info "Included Zadig: $Zadig" }

# ── Manifest ──────────────────────────────────────────────────────────────────

$commit = (git -C $VialQmkRoot rev-parse HEAD 2>$null)
$dirty  = @(git -C $VialQmkRoot status --short 2>$null | ForEach-Object { $_.Trim() })
$manifest = [ordered]@{
    name       = 'iris-fw-env'
    version    = $PackVersion
    created    = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    keyboard   = 'keebio/iris_lm/k1'
    keymap     = 'vial'
    qmk_commit = $commit
    qmk_dirty  = $dirty
}
$manifest | ConvertTo-Json -Depth 3 | Out-File "$stage\manifest.json" -Encoding utf8
Info "Wrote manifest (commit $commit, $($dirty.Count) dirty files)"

# ── Validate (test compile against the staged tree) ───────────────────────────

if ($Validate) {
    Info 'Validation compile: make keebio/iris_lm/k1:vial SKIP_GIT=yes'
    $bash = "$stage\toolchain\usr\bin\bash.exe"
    $qmkMsys = Windows-ToMsysPath "$stage\vial-qmk"
    $env:MSYSTEM = 'MINGW64'
    $env:CHERE_INVOKING = '1'
    $env:HOME = "$stage\toolchain\home"
    & $bash -l -c "cd '$qmkMsys' && make keebio/iris_lm/k1:vial SKIP_GIT=yes 2>&1" |
        ForEach-Object { Write-Host $_ }
    $binFile = "$stage\vial-qmk\.build\keebio_iris_lm_k1_vial.bin"
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $binFile)) {
        Fail "Validation compile FAILED - the trimmed toolchain is missing something. Stage left at $stage for inspection."
    }
    Info "Validation compile OK: $binFile"
    # Keep build artifacts out of the pack (make also copies the .bin/.hex to the repo root).
    Remove-Item "$stage\vial-qmk\.build" -Recurse -Force
    Get-ChildItem "$stage\vial-qmk" -File |
        Where-Object { $_.Name -match '^keebio_iris_lm.*\.(bin|hex|elf)$' } |
        Remove-Item -Force
}

# ── Report + zip ──────────────────────────────────────────────────────────────

Info ("Staged sizes: toolchain {0} MB, vial-qmk {1} MB" -f (Get-DirSizeMB "$stage\toolchain"), (Get-DirSizeMB "$stage\vial-qmk"))

if ($SkipZip) { Info "SkipZip set - stage ready at $stage"; exit 0 }

$zipPath = Join-Path $OutputDir "iris-fw-env-v$PackVersion.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Info "Zipping to $zipPath (several minutes)"
# .NET ZipFile handles >4 GB archives (zip64) reliably; Windows' bundled tar.exe
# silently produced a truncated/corrupt zip at this size.
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stage, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)

# Verify the archive is readable end-to-end before declaring success.
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$entryCount = $zip.Entries.Count
$zip.Dispose()
$fileCount = (Get-ChildItem $stage -Recurse -File -Force | Measure-Object).Count
if ($entryCount -lt $fileCount) { Fail "Zip is incomplete: $entryCount entries vs $fileCount staged files." }

Info ("Done: {0} ({1} MB, {2} entries)" -f $zipPath, [math]::Round((Get-Item $zipPath).Length / 1MB), $entryCount)
Info "Stage retained at $stage - delete it manually once the zip is verified."
