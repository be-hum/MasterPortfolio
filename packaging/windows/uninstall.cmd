@echo off
rem Uninstall MasterPortfolio (your result folder is kept).
start "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uninstall.ps1"
