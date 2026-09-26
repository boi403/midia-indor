@echo off
setlocal enabledelayedexpansion
title CMS Midia Indoor - Sistema Completo

rem Usa a pasta onde este arquivo .bat esta, nao um caminho fixo
rem (assim funciona em C:\midia-indor, C:\Users\...\Downloads\midia-indor, etc.)
set BASE=%~dp0
cd /d "%BASE%cms-backend"

echo ========================================
echo  CMS Midia Indoor - iniciando...
echo ========================================
echo.

rem So instala as dependencias se faltar alguma (nao trava o boot esperando
rem internet toda vez). "ws" so existe a partir da versao 2.0: instalacoes
rem da v1 tambem passam por aqui uma vez.
if not exist "node_modules\ws" (
    echo Instalando dependencias do servidor, aguarde...
    call npm install
)

rem Painel administrativo: compila uma vez; depois o proprio servidor entrega
rem o painel em http://localhost:3000 (e pelo IP desta maquina na rede).
if not exist "%BASE%cms-admin\dist\index.html" (
    echo Compilando o painel administrativo, aguarde...
    pushd "%BASE%cms-admin"
    if not exist "node_modules" call npm install
    call npm run build
    popd
)

:loop_servidor
echo Iniciando servidor...
node server.js
rem codigo 2 = a porta 3000 ja esta em uso: outro servidor (a tarefa automatica
rem do Windows) ja esta no ar. Nao adianta ficar tentando.
if "%errorlevel%"=="2" goto ja_rodando
echo.
echo O servidor parou inesperadamente. Reiniciando em 5 segundos...
rem "ping" em vez de "timeout": timeout falha quando roda sem janela (tarefa do
rem Windows) e o laco viraria reinicio sem pausa.
ping -n 6 127.0.0.1 > nul
goto loop_servidor

:ja_rodando
rem sem janela (tarefa automatica) nao ha ninguem para apertar uma tecla
if /i "%~1"=="/servico" exit /b 0
echo.
echo O servidor JA ESTA RODANDO (provavelmente iniciado automaticamente com o Windows).
echo Abra http://localhost:3000 no navegador. Para parar, use parar-servidor.bat.
echo.
pause
