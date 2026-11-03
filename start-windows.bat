@echo off
setlocal
title Shiv Sonography Clinic Suite - LAN Server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed on this computer.
  echo  Download the LTS version from https://nodejs.org - install it - then run this file again.
  echo.
  pause
  exit /b 1
)

node -e "var v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=13)?0:1)"
if errorlevel 1 (
  echo.
  echo  WARNING: this Node.js is older than 22.13 - the built-in SQLite database is not available
  echo  and a slower JSON file store will be used. Install the current LTS from https://nodejs.org
  echo.
  pause
)

if not exist "node_modules\express" (
  echo Installing server components - first run only, needs internet ...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo Installation failed. Check the internet connection and run this file again.
    pause
    exit /b 1
  )
)

echo.
echo Starting the clinic server. Keep this window open while the clinic is working.
echo Other computers, tablets and phones open the LAN address shown below.
echo.
node --no-warnings server.js
echo.
echo The clinic server has stopped.
pause
