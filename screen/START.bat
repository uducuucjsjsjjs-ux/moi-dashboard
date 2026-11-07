@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First start: downloading Electron, internet is required. This can take a few minutes...
  call npm install
  if errorlevel 1 (
    echo Install failed. Copy the error text above and send it to the chat.
    pause
    exit /b 1
  )
)
call npm start
