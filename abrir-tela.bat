@echo off
title CMS Midia Indoor - Tela Player

echo Aguardando o servidor responder...
:espera_servidor
curl -s -f -o nul http://localhost:3000/health
if errorlevel 1 (
    timeout /t 2 /nobreak > nul
    goto espera_servidor
)

:loop_navegador
rem So abre o navegador se nao tiver nenhum Chrome/Edge aberto ainda
tasklist /FI "IMAGENAME eq chrome.exe" 2>nul | find /I "chrome.exe" >nul
if errorlevel 1 (
    tasklist /FI "IMAGENAME eq msedge.exe" 2>nul | find /I "msedge.exe" >nul
    if errorlevel 1 (
        echo Abrindo tela de exibicao...
        rem Endereco da v1: continua entrando sem codigo de ativacao ("Tela Principal (legado)").
        rem TVs novas: abra http://IP-DO-SERVIDOR:3000/tv e vincule pelo codigo no painel.
        rem --autoplay-policy libera o som dos videos quando o volume da TV for maior que 0.
        start "" chrome --kiosk --disable-infobars --noerrdialogs --disable-session-crashed-bubble --no-first-run --autoplay-policy=no-user-gesture-required "http://localhost:3000/player-app/signage-player.html"
        if errorlevel 1 start "" msedge --kiosk --no-first-run --autoplay-policy=no-user-gesture-required "http://localhost:3000/player-app/signage-player.html"
    )
)

rem Confere de novo daqui a 5s; se o navegador tiver fechado/travado, reabre sozinho
timeout /t 5 /nobreak > nul
goto loop_navegador
