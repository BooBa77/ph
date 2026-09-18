@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM ============================================================
REM  Синхронизация dev-БД ph с прод-БД (через SSH-туннель)
REM  Файл в .gitignore, содержит пароль.
REM ============================================================

REM --- НАСТРОЙКИ ---
set PROD_HOST=host.docker.internal
set PROD_PORT=5433
set PROD_DB=ph
set PROD_USER=ph_migrator
set PROD_PASSWORD=fqHRrppgo03PlZfgICzHmgSwbgSkaWtp

set DEV_DB=ph
set DEV_USER=postgres
set DEV_PASSWORD=postgres
set DEV_VOLUME=ph_dev_postgres_data

REM --- ПРОВЕРКА ТУННЕЛЯ ---
echo ============================================
echo   Синхронизация БД ph: prod -^> dev
echo ============================================
echo.

echo [1/6] Проверяю SSH-туннель...
netstat -ano | findstr ":5433 " | findstr "LISTENING" >nul
if errorlevel 1 (
    echo.
    echo [ОШИБКА] SSH-туннель не запущен.
    echo.
    echo Открой НОВОЕ окно PowerShell и запусти:
    echo     ssh -N ph-db-tunnel
    echo.
    pause
    exit /b 1
)
echo     Туннель работает.

REM --- ПРОВЕРКА DOCKER ---
echo.
echo [2/6] Проверяю Docker...
docker info >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Docker не запущен!
    pause
    exit /b 1
)
echo     Docker работает.

REM --- ОСТАНОВКА И ПЕРЕСОЗДАНИЕ DEV-БД ---
echo.
echo [3/6] Пересоздаю dev-БД...
docker compose down
docker volume rm %DEV_VOLUME% >nul 2>&1
docker compose up -d postgres
echo     Жду 10 секунд, пока Postgres стартует...
timeout /t 10 /nobreak >nul

REM --- ДАМП ПРОД-БД ---
echo.
echo [4/6] Делаю дамп прод-БД через туннель...

for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "dt=%%a"
set "DATE_STR=%dt:~0,4%-%dt:~4,2%-%dt:~6,2%_%dt:~8,2%-%dt:~10,2%"
set "DUMP_FILE=backups\ph_%DATE_STR%.dump"

if not exist "backups" mkdir backups

docker compose exec -T postgres sh -c "PGPASSWORD=%PROD_PASSWORD% pg_dump -h %PROD_HOST% -p %PROD_PORT% -U %PROD_USER% -d %PROD_DB% -Fc" > "%DUMP_FILE%"

if errorlevel 1 (
    echo [ОШИБКА] Не удалось создать дамп прод-БД.
    echo Проверь: правильный ли пароль ph_migrator, работает ли туннель.
    pause
    exit /b 1
)
echo     Дамп сохранён: %DUMP_FILE%

REM --- ВОССТАНОВЛЕНИЕ В DEV ---
echo.
echo [5/6] Восстанавливаю дамп в dev-БД...
type "%DUMP_FILE%" | docker compose exec -T postgres pg_restore -U %DEV_USER% -d %DEV_DB% --no-owner --no-privileges

if errorlevel 1 (
    echo [ОШИБКА] Не удалось восстановить дамп.
    pause
    exit /b 1
)

REM --- ГОТОВО ---
echo.
echo ============================================
echo   СИНХРОНИЗАЦИЯ ЗАВЕРШЕНА
echo ============================================
echo.
echo Дамп: %DUMP_FILE%
echo.
echo Запусти остальные контейнеры:
echo     docker compose up -d
echo.
pause
endlocal