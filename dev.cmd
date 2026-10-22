@echo off
REM ============================================================
REM  dev.cmd - start the Tauri dev environment (Vite + Rust)
REM
REM  Run it from anywhere:  dev.cmd  (or double-click the desktop
REM  shortcut). Stop it with Ctrl+C in the same window.
REM
REM  (Keep this file ASCII-only: cmd.exe mis-parses non-ASCII
REM   comments. A stray UTF-8 comment line gets decoded as the
REM   OEM codepage, and the broken bytes are then executed as a
REM   command - the script keeps going but prints garbage.)
REM ============================================================

setlocal
cd /d "%~dp0"
title JIG Data Finder - dev

REM ---- 0. preconditions ---------------------------------------
REM Fail fast and loudly. Double-clicking a .cmd closes the
REM window the moment the script ends, so every exit path that
REM the user needs to read has a pause in front of it.

where npm >nul 2>&1
if errorlevel 1 (
    echo [dev] npm is not on PATH - install Node.js first
    pause
    exit /b 1
)

REM tauri.cmd is what "npm run tauri:dev" resolves to. Checking it
REM is cheaper and clearer than letting npm fail with
REM "'tauri' is not recognized as an internal or external command".
if not exist "%~dp0node_modules\.bin\tauri.cmd" (
    echo [dev] dependencies missing - run: npm install
    pause
    exit /b 1
)

REM ---- 1. free port 1420 --------------------------------------
REM tauri dev owns 1420 (see src-tauri/tauri.conf.json devUrl).
REM A previous run that was killed instead of Ctrl+C leaves an
REM orphan node holding the port; vite then dies with
REM "Port 1420 is already in use" and tauri reports
REM "The beforeDevCommand terminated with a non-zero status code".
REM
REM KILLED decides whether the wait below is worth doing: only a
REM taskkill can leave the socket in a transient state.

set "PORT=1420"
set "KILLED="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%PORT% "') do (
    echo [dev] port %PORT% busy, stopping PID %%p ...
    taskkill /F /PID %%p >nul 2>&1
    set "KILLED=1"
)
REM taskkill returns before the process is really gone. Without
REM this pause vite occasionally still sees the port as taken.
if defined KILLED timeout /t 1 /nobreak >nul

REM ---- 1b. drop a leftover app instance -----------------------
REM Closing the window only hides it when close_to_tray is on, so
REM an old process otherwise keeps target\debug\jig-data-finder.exe
REM locked and cargo then fails with
REM "failed to remove file ... (os error 5)".
REM
REM taskkill matches by image NAME, not by path, so a release
REM build sitting in dist-package is hit too. Say so instead of
REM killing it silently - otherwise the user just sees their app
REM disappear for no reason.

tasklist /FI "IMAGENAME eq jig-data-finder.exe" 2>nul | findstr /I /C:"jig-data-finder.exe" >nul
if not errorlevel 1 (
    echo [dev] a running JIG instance was found and will be closed
    taskkill /F /IM jig-data-finder.exe >nul 2>&1
    timeout /t 1 /nobreak >nul
)

REM ---- 2. MSVC toolchain ---------------------------------------
REM cargo is on PATH but cl.exe / link.exe are not, so a build fails
REM at link time unless vcvars64 has run.
REM
REM Verify by looking for cl.exe instead of trusting errorlevel.
REM vcvars64.bat ends with whatever its last internal command was, so
REM a perfectly good environment can still leave errorlevel non-zero
REM and we would refuse to start for no reason. "where cl" answers
REM the question we actually care about.

call "%~dp0tools\msvc-env.cmd" >nul
where cl >nul 2>&1
if errorlevel 1 (
    echo [dev] FAILED to load the MSVC environment - cl.exe is not on PATH
    echo [dev] check the vcvars64 path in tools\msvc-env.cmd
    pause
    exit /b 1
)

REM ---- 3. go ---------------------------------------------------
echo [dev] starting tauri dev on http://localhost:1420 ...
echo [dev] press Ctrl+C here to stop.
echo.

call npm run tauri:dev
set "RC=%ERRORLEVEL%"

REM Any non-zero exit means the build or the dev server died while
REM the user was not looking. Hold the window open so the compiler
REM error stays readable.
if not "%RC%"=="0" (
    echo.
    echo [dev] tauri dev exited with code %RC%
    pause
)

REM %RC% has to be expanded BEFORE endlocal runs, hence the "&"
REM on one line. Splitting it into two lines loses the variable.
endlocal & exit /b %RC%
