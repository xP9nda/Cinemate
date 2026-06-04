@echo off
REM --------
REM  Cinemate - Windows build script
REM  Builds the NSIS installer and the portable exe into dist\
REM --------
setlocal

cd /d "%~dp0"

echo.
echo === Cinemate build ===
echo.

REM --- Ensure dependencies are installed ---
if not exist "node_modules\" (
    echo node_modules not found - running "npm install"...
    call npm install
    if errorlevel 1 goto :fail
)

REM --- Build installer + portable ---
echo Building installer and portable exe...
call npm run dist:win
if errorlevel 1 goto :fail

echo.
echo === Build complete ===
echo Artifacts written to: "%~dp0dist"
echo.
dir /b "dist\*.exe" 2>nul
echo.
endlocal
exit /b 0

:fail
echo.
echo *** BUILD FAILED ***
endlocal
exit /b 1
