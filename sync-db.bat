@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ========================================
echo  Синхронизация БД с боевого сервера
echo ========================================

docker info >nul 2>&1
if errorlevel 1 (
    echo ОШИБКА: Docker не запущен!
    pause
    exit /b 1
)

echo [1/6] Останавливаем контейнеры...
docker compose down

echo [2/6] Удаляем старые данные БД...
docker volume rm u40ta_postgres_data >nul 2>&1

echo [3/6] Запускаем чистую БД...
docker compose up -d postgres
timeout /t 10 /nobreak >nul

echo [4/6] Проверяем подключение...
docker compose exec -T postgres pg_isready -U developer -d u40ta_db

echo [5/6] Создаём дамп боевой БД...
set BACKUP_DATE=%DATE:~6,4%%DATE:~3,2%%DATE:~0,2%_%TIME:~0,2%%TIME:~3,2%
set BACKUP_NAME=backup_%BACKUP_DATE%.sql

docker compose exec -T postgres sh -c "echo '80.87.202.52:5432:u40ta_db:u40ta_user:Size2album&handMaid' > /tmp/.pgpass && chmod 600 /tmp/.pgpass && PGPASSFILE=/tmp/.pgpass pg_dump -h 80.87.202.52 -U u40ta_user -d u40ta_db -c --if-exists --no-owner --no-privileges" > "%BACKUP_NAME%"

if errorlevel 1 (
    echo ОШИБКА: Не удалось создать дамп!
    pause
    exit /b 1
)

echo [6/6] Восстанавливаем дамп в dev-БД и сохраняем копию в backup...
type "%BACKUP_NAME%" | docker compose exec -T postgres psql -U developer -d u40ta_db

if errorlevel 1 (
    echo ОШИБКА: Не удалось восстановить дамп в dev-БД!
    pause
    exit /b 1
)

REM Копируем файл в папку backup
copy "%BACKUP_NAME%" "backup\%BACKUP_NAME%"

if errorlevel 1 (
    echo ПРЕДУПРЕЖДЕНИЕ: Не удалось скопировать дамп в папку backup
) else (
    echo Копия сохранена в backup\%BACKUP_NAME%
)

REM Удаляем временный файл в корневой папке
del "%BACKUP_NAME%"

echo ========================================
echo  Синхронизация завершена!
echo  Бэкап сохранён: backup\%BACKUP_NAME%
echo ========================================
pause