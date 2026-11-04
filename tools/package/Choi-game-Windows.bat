@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080/frontend/
  node tools\serve.mjs 8080
) else (
  echo Khong tim thay Node.js - thu dung Python...
  start "" http://localhost:8080/frontend/
  python -m http.server 8080
)
pause
