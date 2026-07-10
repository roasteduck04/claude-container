@echo off
REM One-click setup + launch for Claude Containers (Windows).
REM Double-click this file: it installs Node if missing, installs the app's
REM dependencies the first time, then launches the app.
setlocal
cd /d "%~dp0"

echo ============================================
echo   Claude Containers - setup ^& launch
echo ============================================
echo.

REM ---- 1. Make sure Node.js is available ----
where node >nul 2>nul
if %errorlevel%==0 goto have_node

echo Node.js was not found on this system.
echo.
where winget >nul 2>nul
if %errorlevel%==0 (
    echo Installing Node.js LTS via winget...
    winget install -e --id OpenJS.NodeJS.LTS
    echo.
    echo -----------------------------------------------------------
    echo Node.js has been installed. Windows needs a fresh terminal
    echo to pick it up, so please CLOSE this window and double-click
    echo start.bat again to finish setup.
    echo -----------------------------------------------------------
    pause
    exit /b 0
) else (
    echo winget is not available on this machine, so Node can't be
    echo installed automatically.
    echo.
    echo Please install the Node.js LTS version from:
    echo     https://nodejs.org
    echo Then double-click start.bat again.
    start "" https://nodejs.org
    pause
    exit /b 1
)

:have_node
for /f "delims=" %%v in ('node -v') do echo Using Node %%v

REM ---- 2. Install dependencies on first run ----
if not exist "node_modules\" (
    echo.
    echo First run: installing dependencies with npm install...
    echo (this also downloads the Electron runtime and can take a minute^)
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed.
        echo If it failed downloading Electron specifically, a proxy/firewall
        echo may be blocking GitHub's release host. Try again on an
        echo unrestricted network, or set ELECTRON_MIRROR before retrying.
        echo See the README's proxy note for details.
        pause
        exit /b 1
    )
) else (
    echo Dependencies already installed.
)

REM ---- 3. Launch ----
echo.
echo Launching Claude Containers...
call npm start
if errorlevel 1 (
    echo.
    echo The app exited with an error. See the output above.
    pause
    exit /b 1
)

endlocal
