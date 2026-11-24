@echo off
rem Install MasterPortfolio: copy to %LOCALAPPDATA%\Programs and create Desktop / Start menu shortcuts.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
pause
