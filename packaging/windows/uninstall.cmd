@echo off
rem Uninstall MasterPortfolio (your result folder is kept).
chcp 65001 >nul
start "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uninstall.ps1"
