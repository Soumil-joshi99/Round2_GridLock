@echo off
echo ============================================================
echo  ParkOps — Bengaluru Parking Violation Hotspot Intelligence
echo ============================================================
echo.

set NODE_PATH=D:\Coding\Hackathon\parking-ops\node_env\Scripts
set PATH=%NODE_PATH%;%PATH%

echo [1/2] Starting FastAPI backend on http://localhost:8000 ...
start "ParkOps Backend" cmd /k "cd /d D:\Coding\Hackathon\parking-ops && python backend\run.py"

echo Waiting for backend to load CSV (~30s)...
timeout /t 35 /nobreak > nul

echo [2/2] Starting Vite frontend on http://localhost:5173 ...
start "ParkOps Frontend" cmd /k "cd /d D:\Coding\Hackathon\parking-ops\frontend && npm run dev"

echo.
echo ============================================================
echo  Backend:   http://localhost:8000
echo  Frontend:  http://localhost:5173
echo  API docs:  http://localhost:8000/docs
echo ============================================================
echo.
timeout /t 5 /nobreak > nul
start "" http://localhost:5173
