@echo off
rem Install MasterPortfolio: copy to %LOCALAPPDATA%\Programs and create Desktop / Start menu shortcuts.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
pause
