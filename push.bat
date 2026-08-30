@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   BiliPlaylist 一键推送 GitHub
echo ============================================
echo.
git status -sb
echo.
echo 正在推送 main 到 GitHub ...
git push origin main
echo.
if %errorlevel%==0 (
  echo [✓] 推送成功
) else (
  echo [x] 推送失败：请检查网络（Clash 等代理是否开启），然后重新双击本文件
)
echo.
pause
