@echo off
cd /d "%~dp0"
echo Open http://localhost:8000 on this computer.
echo For iPhone installation, deploy the docs folder to an HTTPS host.
where py >nul 2>nul
if errorlevel 1 goto usepython
py -3 -m http.server 8000 --bind 127.0.0.1 --directory docs
goto done
:usepython
python -m http.server 8000 --bind 127.0.0.1 --directory docs
:done
pause
