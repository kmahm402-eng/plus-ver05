@echo off
chcp 932 >nul
cd /d %~dp0
echo ============================================
echo  CB入力と集計（第1段階）を元に戻します
echo ============================================
copy /Y src\pages\Report.jsx.bak_cb_20261015 src\pages\Report.jsx
copy /Y src\pages\Home.jsx.bak_cb_20261015 src\pages\Home.jsx
copy /Y src\App.jsx.bak_20261009 src\App.jsx
copy /Y src\pages\Manage.jsx.bak_20261009 src\pages\Manage.jsx
echo.
echo [1/2] ビルド中...
call npm run build
if errorlevel 1 ( echo ビルドに失敗しました。 & pause & exit /b 1 )
echo [2/2] 公開中...
call firebase deploy --only hosting
if errorlevel 1 ( echo 公開に失敗しました。 & pause & exit /b 1 )
echo.
echo 元に戻しました。
pause
