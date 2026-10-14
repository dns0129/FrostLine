@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 server.py %*
  if errorlevel 1 pause
  exit /b
)
where python >nul 2>nul
if not errorlevel 1 (
  python server.py %*
  if errorlevel 1 pause
  exit /b
)
echo 未找到 Python 3。请先从 https://www.python.org/downloads/ 安装。
echo 安装时勾选 Add Python to PATH，然后重新双击此文件。
pause
exit /b 1
