@echo off
rem Para o servidor do CMS (processo que escuta a porta do servidor), inclusive
rem o iniciado automaticamente com o Windows ou por uma janela do iniciar-tudo.bat.
if /i not "%~1"=="/silencioso" (
    net session >nul 2>&1
    if errorlevel 1 (
        powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
        exit /b
    )
)

rem A porta pode ser customizada pela variavel de ambiente PORT (a mesma que o
rem servidor usa, veja cms-backend\server.js); sem ela, usa 3000 (padrao).
if not defined PORT set "PORT=3000"

rem Encerra primeiro a tarefa agendada (senao o laco sobe o servidor de novo)
schtasks /End /TN "CMS Midia Indoor" >nul 2>&1

rem Encerra o node da porta do servidor e o cmd.exe do iniciar-tudo.bat que o reinicia
powershell -NoProfile -Command ^
  "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;" ^
  "if (-not $c) { 'O servidor nao estava rodando.'; exit }" ^
  "$p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $c.OwningProcess);" ^
  "$pai = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p.ParentProcessId) -ErrorAction SilentlyContinue;" ^
  "if ($pai -and $pai.Name -eq 'cmd.exe') { Stop-Process -Id $pai.ProcessId -Force -ErrorAction SilentlyContinue }" ^
  "Stop-Process -Id $p.ProcessId -Force; 'Servidor parado.'"

rem parada intencional: o proximo inicio nao deve avisar "reiniciou apos falha"
if exist "%~dp0cms-backend\.em-execucao" del "%~dp0cms-backend\.em-execucao"

if /i not "%~1"=="/silencioso" pause
