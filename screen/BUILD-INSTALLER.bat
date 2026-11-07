@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
net session >nul 2>nul
if errorlevel 1 (
  echo.
  echo NOTE: this file is NOT running as Administrator.
  echo If the build fails with "Cannot create symbolic link", close this window and
  echo run BUILD-INSTALLER.bat again: right click - Run as administrator.
  echo.
)
rem remove a half-extracted cache left by a failed build
if exist "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" >nul 2>nul
echo Installing components and building the installer. Internet is required, 5-10 minutes...
call npm install
if errorlevel 1 goto fail
if not exist "node_modules\ffmpeg-static\ffmpeg.exe" (
  echo ffmpeg was not downloaded by npm install. Recording and the video editor will not work.
  echo Check the internet connection and run this file again.
  goto fail
)
call npm run dist
if errorlevel 1 goto fail
echo.
echo Done. The installer (Setup) and the portable version are in the dist folder.
start "" "%~dp0dist"
pause
exit /b 0
:fail
echo.
echo Build failed. If you see "Cannot create symbolic link": run this file as Administrator
echo (right click - Run as administrator) or enable Developer Mode in Windows Settings.
echo Otherwise copy the error text above and send it to the chat.
pause
exit /b 1
