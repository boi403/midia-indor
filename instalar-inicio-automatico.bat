@echo off
rem Faz o CMS iniciar sozinho junto com o Windows, mesmo sem ninguem logado
rem (tarefa agendada "CMS Midia Indoor", conta SYSTEM). Precisa de administrador.
title CMS Midia Indoor - inicio automatico

net session >nul 2>&1
if errorlevel 1 (
    echo Pedindo permissao de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

set BASE=%~dp0
set TAREFA=CMS Midia Indoor

echo ========================================
echo  Instalando inicio automatico
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo ERRO: o Node.js nao esta no PATH do sistema. Instale o Node.js e rode de novo.
    pause
    exit /b 1
)

rem Pega o caminho completo do node.exe: a tarefa agendada roda como SYSTEM, que
rem pode nao ter o Node no PATH (ex.: instalacao so para este usuario, ou via
rem nvm-windows). Gravando o caminho completo na tarefa, ela funciona mesmo
rem sem o Node no PATH do SYSTEM.
set "NODE_EXE="
for /f "delims=" %%N in ('where node') do if not defined NODE_EXE set "NODE_EXE=%%N"

rem Inicia 30s apos o boot (rede pronta). Sem limite de tempo de execucao.
schtasks /Create /TN "%TAREFA%" /TR "\"%BASE%iniciar-tudo.bat\" /servico \"%NODE_EXE%\"" /SC ONSTART /DELAY 0000:30 /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 (
    echo ERRO ao criar a tarefa.
    pause
    exit /b 1
)
powershell -NoProfile -Command "$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1); Set-ScheduledTask -TaskName '%TAREFA%' -Settings $s | Out-Null"

echo.
echo Impedindo o PC de entrar em suspensao/hibernacao na tomada
echo (um PC dormindo derruba todas as TVs)...
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

echo.
echo Parando uma janela do servidor que esteja aberta, para a tarefa assumir...
call "%BASE%parar-servidor.bat" /silencioso

echo Iniciando agora...
schtasks /Run /TN "%TAREFA%" >nul

echo.
echo ========================================
echo  Pronto. O servidor agora:
echo   - inicia sozinho quando o PC liga (sem precisar fazer login)
echo   - reinicia sozinho se cair
echo   - grava os registros em cms-backend\logs
echo.
echo  Painel: http://localhost:3000
echo  Para desfazer: remover-inicio-automatico.bat
echo ========================================
echo.
echo AVISO: se voce configurar "copia_extra" no config.json apontando para uma
echo unidade de rede mapeada (ex.: Z:\) ou uma pasta do Google Drive/OneDrive,
echo isso pode NAO funcionar quando o servidor roda como tarefa agendada (conta
echo SYSTEM), pois o SYSTEM normalmente nao ve unidades mapeadas nem pastas de
echo sincronizacao do usuario que esta logado. Use um caminho de rede UNC
echo (\\servidor\pasta) ou copie os backups manualmente para esses destinos.
pause
