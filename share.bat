@echo off
setlocal

REM ----------------------------------------------------------
REM Share script (use start.bat for development)
REM
REM Steps:
REM   1) Build frontend (npm run build -> dist/)
REM   2) Run FastAPI on port 8765 (serves API + React static)
REM   3) Run cloudflared tunnel -> public URL
REM
REM Stop: Ctrl+C in each window or close the windows
REM ----------------------------------------------------------

set "BASE=%~dp0"
set "FRONT=%BASE%frontend"

echo.
echo [1/3] Building frontend...
echo.
pushd "%FRONT%"
call npm.cmd run build
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed. See errors above.
  popd
  pause
  exit /b 1
)
popd

echo.
echo [2/3] Starting FastAPI server on port 8765...
start "Wafer Server" cmd /k "cd /d %BASE% && python -m uvicorn api.main:app --host 0.0.0.0 --port 8765"

echo.
echo [3/3] Starting Cloudflare tunnel...
echo.
echo Look for a URL like https://xxxx.trycloudflare.com in the new window.
echo Share that URL with your friend.
echo (Closing the server or tunnel window will kill the link.)
echo.
start "Cloudflare Tunnel" cmd /k "cloudflared tunnel --url http://localhost:8765"

echo.
echo ======================================================
echo  Server and tunnel are running in new windows.
echo  - Local:    http://localhost:8765
echo  - Public:   see the trycloudflare.com URL in tunnel window
echo ======================================================
echo.
pause