@echo off
title CMS Midia Indoor - Tela Player

rem A porta pode ser customizada pela variavel de ambiente PORT (a mesma que o
rem servidor usa, veja cms-backend\server.js); sem ela, usa 3000 (padrao).
if not defined PORT set "PORT=3000"

echo Aguardando o servidor responder...
:espera_servidor
curl -s -f -o nul http://localhost:%PORT%/health
if errorlevel 1 (
    timeout /t 2 /nobreak > nul
    goto espera_servidor
)

:loop_navegador
rem So abre o navegador se a tela do kiosk (o player desta pagina) ainda nao
rem estiver rodando. Olhar so pelo nome "chrome.exe"/"msedge.exe" dava falso
rem positivo quando a pessoa tinha um Chrome/Edge comum aberto para outra
rem coisa, entao confere a linha de comando do processo, nao so o nome.
wmic process where "name='chrome.exe'" get commandline 2>nul | findstr /I "signage-player.html" >nul
if errorlevel 1 (
    wmic process where "name='msedge.exe'" get commandline 2>nul | findstr /I "signage-player.html" >nul
    if errorlevel 1 (
        echo Abrindo tela de exibicao...
        rem Endereco da v1: continua entrando sem codigo de ativacao ("Tela Principal (legado)").
        rem TVs novas: abra http://IP-DO-SERVIDOR:%PORT%/tv e vincule pelo codigo no painel.
        rem --autoplay-policy libera o som dos videos quando o volume da TV for maior que 0.
        start "" chrome --kiosk --disable-infobars --noerrdialogs --disable-session-crashed-bubble --no-first-run --autoplay-policy=no-user-gesture-required "http://localhost:%PORT%/player-app/signage-player.html"
        if errorlevel 1 start "" msedge --kiosk --no-first-run --autoplay-policy=no-user-gesture-required "http://localhost:%PORT%/player-app/signage-player.html"
    )
)

rem Confere de novo daqui a 5s; se o navegador tiver fechado/travado, reabre sozinho
timeout /t 5 /nobreak > nul
goto loop_navegador
