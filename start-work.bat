@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   НАЧАЛО РАБОЧЕГО ДНЯ — PH
echo ============================================
echo.

echo [1/3] Получаю последние изменения из git...
git pull
if errorlevel 1 (
    echo.
    echo [ОШИБКА] git pull не удался. Возможно, есть конфликты.
    echo Разберись с ними, потом запусти снова.
    pause
    exit /b 1
)

echo.
echo [2/3] Запускаю Docker-контейнеры...
docker compose up -d

echo.
echo [3/3] Проверяю, что backend отвечает...
timeout /t 10 /nobreak >nul
curl.exe -s http://localhost:3000/api/health
echo.

echo.
echo ============================================
echo   ГОТОВО. Удачной работы!
echo ============================================
echo.
echo Backend:  http://localhost:3000/api/health
echo Frontend: http://localhost:5173
echo.
pause