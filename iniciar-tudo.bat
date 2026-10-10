@echo off
setlocal enabledelayedexpansion
title CMS Midia Indoor - Sistema Completo

rem Usa a pasta onde este arquivo .bat esta, nao um caminho fixo
rem (assim funciona em C:\midia-indor, C:\Users\...\Downloads\midia-indor, etc.)
set BASE=%~dp0
cd /d "%BASE%cms-backend"

rem Se a tarefa agendada (conta SYSTEM) passar o caminho completo do node.exe
rem como segundo parametro (gravado por instalar-inicio-automatico.bat), usa
rem esse caminho; senao usa "node" do PATH normal (quando roda manualmente).
set "NODE_CMD=node"
if not "%~2"=="" set "NODE_CMD=%~2"

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
    if !errorlevel! neq 0 (
        echo ERRO: npm install falhou. Verifique sua conexao com a internet ou rode manualmente para ver o erro completo.
        pause
        exit /b 1
    )
)

rem Painel administrativo: recompila quando o dist nao existe, quando falta a
rem marca da ultima compilacao, ou quando o pacote foi atualizado depois dela
rem (assim uma atualizacao do codigo nao fica servindo o build antigo para
rem sempre - antes so recompilava se a pasta dist nao existisse).
set "PRECISA_BUILD=0"
if not exist "%BASE%cms-admin\dist\index.html" set "PRECISA_BUILD=1"
if not exist "%BASE%cms-admin\dist\.build-stamp" set "PRECISA_BUILD=1"
if "%PRECISA_BUILD%"=="0" (
    powershell -NoProfile -Command "exit [int]((Get-Item '%BASE%cms-admin\package.json').LastWriteTime -gt (Get-Item '%BASE%cms-admin\dist\.build-stamp').LastWriteTime)"
    if !errorlevel! equ 1 set "PRECISA_BUILD=1"
)
if "%PRECISA_BUILD%"=="1" (
    echo Compilando o painel administrativo, aguarde...
    pushd "%BASE%cms-admin"
    if not exist "node_modules" (
        call npm install
        if !errorlevel! neq 0 (
            echo ERRO: npm install do painel administrativo falhou. Verifique sua conexao com a internet ou rode manualmente para ver o erro completo.
            popd
            pause
            exit /b 1
        )
    )
    call npm run build
    if !errorlevel! neq 0 (
        echo ERRO: a compilacao do painel administrativo falhou. Rode "npm run build" manualmente dentro da pasta cms-admin para ver o erro completo.
        popd
        pause
        exit /b 1
    )
    echo. > "%BASE%cms-admin\dist\.build-stamp"
    popd
)

rem O token de dispositivo legado "dev_local" (TVs da v1) agora so e criado se
rem esta variavel estiver habilitada. Comente/remova esta linha quando todas as
rem TVs antigas forem repareadas pelo sistema novo (Dispositivos > Adicionar).
set "LEGACY_DEV_LOCAL=1"

:loop_servidor
echo Iniciando servidor...
"%NODE_CMD%" server.js
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
