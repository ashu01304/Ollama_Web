@echo off
setlocal

echo This script helps configure Ollama to accept connections from the browser extension.
echo It needs Administrator privileges to modify system environment variables.
echo.

:: Check for Administrator privileges
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Requesting administrative privileges...
    powershell -Command "Start-Process cmd.exe -ArgumentList '/c %~s0' -Verb RunAs"
    exit /b
)

:main
    set "OLLAMA_VAR=OLLAMA_ORIGINS"
    set "OLLAMA_VALUE=chrome-extension://*,moz-extension://*"
    
    echo The required value for %OLLAMA_VAR% is: "%OLLAMA_VALUE%"
    echo This script will set this as a permanent System Environment Variable.
    echo.
    
    setx %OLLAMA_VAR% "%OLLAMA_VALUE%" /M
    
    if %errorlevel% equ 0 (
        echo.
        echo ====================================================================
        echo  SUCCESS! The %OLLAMA_VAR% environment variable has been set.
        echo.
        echo  IMPORTANT: You must RESTART the Ollama application for this
        echo  change to take effect (Quit from system tray and restart).
        echo ====================================================================
    ) else (
        echo.
        echo ERROR: Failed to set the environment variable.
    )

:end
    echo.
    pause
    endlocal