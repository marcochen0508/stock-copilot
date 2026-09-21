@echo off
chcp 65001 >nul
echo ========================================================
echo   正在啟動【台股智能決策戰情室】...
echo   自動連線 Google 雲端試算表與美股/台股即時數據
echo ========================================================
echo.

start "" "http://127.0.0.1:8088"
python -m uvicorn app:app --host 127.0.0.1 --port 8088 --reload

pause
