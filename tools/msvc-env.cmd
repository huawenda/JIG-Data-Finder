@echo off
REM Load MSVC x64 build environment for cargo / tauri builds.
REM (Keep this file ASCII-only: cmd.exe mis-parses non-ASCII comments.)
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" %*