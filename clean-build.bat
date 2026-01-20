@echo off
echo ========================================
echo Cleaning TradeButler Build Artifacts
echo ========================================
echo.
echo This will delete build artifacts but keep source code.
echo.
echo WARNING: This will delete:
echo   - src-tauri\target\ (all build artifacts)
echo   - dist\ (frontend build output)
echo.
echo It will KEEP:
echo   - All source code
echo   - Configuration files
echo   - Icons
echo.
set /p confirm="Are you sure? (y/N): "
if /i not "%confirm%"=="y" (
    echo Cancelled.
    pause
    exit /b 0
)

echo.
echo Cleaning build artifacts...

if exist "src-tauri\target" (
    echo Deleting src-tauri\target\...
    rmdir /s /q "src-tauri\target"
    echo   - Deleted
) else (
    echo   - src-tauri\target\ not found (already clean)
)

if exist "dist" (
    echo Deleting dist\...
    rmdir /s /q "dist"
    echo   - Deleted
) else (
    echo   - dist\ not found (already clean)
)

echo.
echo ========================================
echo Clean Complete!
echo ========================================
echo.
echo You can now rebuild using: build.bat
echo.
pause
