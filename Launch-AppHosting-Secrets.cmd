@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul 2>nul
title Firebase App Hosting Secrets Tool

set "NO_PAUSE=0"
if /I "%~1"=="--no-pause" (
  set "NO_PAUSE=1"
  shift
)

where node >nul 2>nul
if errorlevel 1 (
  echo [Error] Node.js was not found in PATH.
  echo Install Node.js and try again.
  echo.
  if "%NO_PAUSE%"=="0" pause
  exit /b 1
)

where firebase >nul 2>nul
if errorlevel 1 (
  echo [Error] Firebase CLI was not found in PATH.
  echo Install it first: npm i -g firebase-tools
  echo.
  if "%NO_PAUSE%"=="0" pause
  exit /b 1
)

if not exist "scripts\apphosting-secrets.mjs" (
  echo [Error] File not found: scripts\apphosting-secrets.mjs
  echo.
  if "%NO_PAUSE%"=="0" pause
  exit /b 1
)

node "scripts\apphosting-secrets.mjs" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo Tool exited with error code: %EXIT_CODE%
) else (
  echo Tool finished successfully.
)
echo.
if "%NO_PAUSE%"=="0" pause
exit /b %EXIT_CODE%
