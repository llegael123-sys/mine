@echo off
rem Abre PrivAI con doble clic.
cd /d "%~dp0"
echo Preparando PrivAI...
python -m pip install -q -e . || (echo No se encontro Python. Instalalo desde https://python.org & pause & exit /b 1)
python -m privai chat
pause
