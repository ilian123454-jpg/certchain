@echo off
chcp 65001 >nul
echo Стартиране на CertChain (Docker Desktop трябва да е пуснат)...
docker compose up --build -d
if errorlevel 1 (
  echo Неуспешно стартиране. Проверете дали Docker Desktop работи.
  pause
  exit /b 1
)
echo Изчакване на приложението...
timeout /t 20 >nul
start http://localhost:3000
echo Готово. Спиране: docker compose down
pause
