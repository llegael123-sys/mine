@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Falta instalar Node.js. Se va a abrir la pagina para descargarlo.
  echo  Instalalo apretando Siguiente en todo y despues volve a abrir este archivo.
  echo.
  start https://nodejs.org/es/download
  pause
  exit /b
)

echo.
echo  Iniciando la app de Herrajes...
echo  NO CIERRES ESTA VENTANA mientras usen la app.
echo  En el celular abri la direccion que dice "Red local".
echo.
node server.js --abrir
pause
