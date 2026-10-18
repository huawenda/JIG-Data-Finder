@echo off
REM ============================================================
REM  dev.cmd - start the Tauri dev environment (Vite + Rust)
REM
REM  Run it from anywhere:  dev.cmd
REM  Stop it with Ctrl+C in the same window.
REM
REM  (Keep this file ASCII-only: cmd.exe mis-parses non-ASCII
REM   comments, which silently breaks the whole script.)
REM ============================================================

setlocal
cd /d "%~dp0"

REM ---- 1. free port 1420 --------------------------------------
REM tauri dev owns 1420 (see src-tauri/tauri.conf.json devUrl).
REM A previous run that was killed instead of Ctrl+C leaves an
REM orphan node holding the port; vite then dies with
REM "Port 1420 is already in use" and tauri reports
REM "The beforeDevCommand terminated with a non-zero status code".

set "PORT=1420"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%PORT% "') do (
    echo [dev] port %PORT% busy, stopping PID %%p ...
    taskkill /F /PID %%p >nul 2>&1
)

REM Also drop a leftover app instance. Closing the window only hides
REM it when close_to_tray is on, so an old process otherwise keeps
REM target\debug\jig-data-finder.exe locked and cargo then fails with
REM "failed to remove file ... (os error 5)".
taskkill /F /IM jig-data-finder.exe >nul 2>&1

REM ---- 2. MSVC toolchain ---------------------------------------
REM cargo is on PATH but cl.exe / link.exe are not, so a build fails
REM at link time unless vcvars64 has run.
call "%~dp0tools\msvc-env.cmd" >nul
if errorlevel 1 (
    echo [dev] FAILED to load the MSVC environment - see tools\msvc-env.cmd
    exit /b 1
)

REM ---- 3. go ---------------------------------------------------
echo [dev] starting tauri dev on http://localhost:1420 ...
call npm run tauri:dev
endlocal