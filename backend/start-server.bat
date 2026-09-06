@echo off
cd /d "%~dp0"
set VOTECORE_PORT=5000
venv\Scripts\python.exe app.py
