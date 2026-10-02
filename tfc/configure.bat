@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or newer is required.
  pause
  exit /b 1
)
node "%~dp0configure.js" %*
set "LID_TFC_CONFIG_EXIT=%errorlevel%"
pause
exit /b %LID_TFC_CONFIG_EXIT%
