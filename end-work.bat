@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   КОНЕЦ РАБОЧЕГО ДНЯ — PH
echo ============================================
echo.

echo [1/3] Проверяю статус git...
git status
echo.

set /p COMMIT_MSG="Введи сообщение коммита (или Enter для 'WIP'): "
if "%COMMIT_MSG%"=="" set COMMIT_MSG=WIP

echo.
echo [2/3] Коммичу и пушу изменения...
git add .
git commit -m "%COMMIT_MSG%"
git push

echo.
echo [3/3] Останавливаю Docker-контейнеры...
docker compose down

echo.
echo ============================================
echo   ГОТОВО. До завтра!
echo ============================================
echo.
pause