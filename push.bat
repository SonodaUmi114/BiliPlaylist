@echo off
cd /d "%~dp0"
echo ============================================
echo   BiliPlaylist - Push to GitHub
echo ============================================
echo.
git status -sb
echo.
echo Pushing main to GitHub ...
git push origin main
echo.
if %errorlevel%==0 (
  echo [OK] Push succeeded.
) else (
  echo [FAILED] Push failed. Check network/proxy and retry.
)
echo.
pause
