@echo off
rem Remove a tarefa de inicio automatico e para o servidor.
net session >nul 2>&1
if errorlevel 1 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
schtasks /End /TN "CMS Midia Indoor" >nul 2>&1
schtasks /Delete /TN "CMS Midia Indoor" /F
call "%~dp0parar-servidor.bat" /silencioso
echo.
echo Inicio automatico removido. Para rodar manualmente use iniciar-tudo.bat.
pause
