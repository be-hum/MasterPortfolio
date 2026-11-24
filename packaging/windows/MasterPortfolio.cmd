@echo off
rem MasterPortfolio launcher (Windows). Double-click to start.
setlocal
chcp 65001 >nul
set "HERE=%~dp0"
set "PATH=%HERE%runtime;%PATH%"
title MasterPortfolio
"%HERE%runtime\node.exe" "%HERE%app\dist\cli.js" start
if errorlevel 1 (
  echo.
  pause
)
endlocal
