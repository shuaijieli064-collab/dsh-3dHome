@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   马维斯的小家 · Marvis Home
echo   正在启动本地服务（演示剧本模式）...
echo.

start "Marvis Home" cmd /c "node server.mjs --demo"
timeout /t 2 /nobreak >nul
start "" "http://localhost:5173"

echo   浏览器已打开 http://localhost:5173
echo   关闭那个黑色窗口即可停止服务。
echo.
timeout /t 3 /nobreak >nul
