@echo off
REM ============================================================
REM Build verification WITHOUT Python (one-off script)
REM
REM Purpose: prove the product build chain does not need Python.
REM How: build a clean PATH containing only Windows / Node /
REM      Cargo, then run the real tauri build.
REM
REM NOTE: keep this file ASCII-only. cmd.exe mis-parses
REM       non-ASCII comments and garbles the whole script.
REM
REM Usage: cmd /c tools\build-no-python.cmd
REM ============================================================

setlocal

set "SAVED_PATH=%PATH%"

where node >nul 2>&1
if errorlevel 1 (
  echo [FAIL] node not found in PATH
  exit /b 1
)
for /f "delims=" %%i in ('where node') do set "NODE_DIR=%%~dpi"
for /f "delims=" %%i in ('where node') do set "NODE_BIN=%%i"

if defined USERPROFILE (
  if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "CARGO_BIN=%USERPROFILE%\.cargo\bin"
)

echo === Clean build environment (no Python) ===
echo node  : %NODE_BIN%
echo cargo : %CARGO_BIN%
echo.

REM Critical: PATH holds only Windows system dirs - no Python anywhere.
set "PATH=C:\Windows\System32;C:\Windows;%CARGO_BIN%;%NODE_DIR%"

where python >nul 2>&1
if not errorlevel 1 (
  echo [FAIL] python unexpectedly present in PATH - env is not clean
  exit /b 1
)
echo [OK] python is NOT in PATH
echo.

REM Load MSVC env. vcvars appends to PATH rather than replacing it.
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1

echo === Building ===
call "%NODE_BIN%" ".\node_modules\@tauri-apps\cli\tauri.js" build %*
set "BUILD_EXIT=%ERRORLEVEL%"

echo.
if "%BUILD_EXIT%"=="0" (
  echo [OK] Build succeeded without Python
) else (
  echo [FAIL] Build failed exit=%BUILD_EXIT%
)

endlocal & exit /b %BUILD_EXIT%