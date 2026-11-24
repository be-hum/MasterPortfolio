@echo off
rem MasterPortfolio launcher (Windows). Double-click to start.
rem No "chcp 65001": in the classic console it breaks Korean IME (han/eng toggle). Node writes Unicode to the console regardless of code page.
setlocal
set "HERE=%~dp0"
set "PATH=%HERE%runtime;%PATH%"
title MasterPortfolio
"%HERE%runtime\node.exe" "%HERE%app\dist\cli.js" start
if errorlevel 1 (
  echo.
  pause
)
endlocal
