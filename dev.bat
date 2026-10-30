@echo off
rem Modo desarrollo: trae los cambios de GitHub cada 15 s y reinicia el servidor solo.
rem Uso: doble clic en este archivo. Luego abre http://localhost:3100 y pulsa F5 para ver los cambios.
cd /d %~dp0
set PORT=3100
call npm install --no-audit --no-fund
if not exist data call npm run seed
start "auto-pull" /min cmd /c "for /l %%i in (0,0,1) do (git pull --ff-only -q & timeout /t 15 /nobreak >nul)"
echo.
echo  VitalTrack en http://localhost:3100  (usuario: regente / regente123)
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo  Desde el celular (misma red Wi-Fi): http://%%a:3100
echo  Cierra esta ventana para detener todo.
echo.
node --watch --no-warnings src/server.js
