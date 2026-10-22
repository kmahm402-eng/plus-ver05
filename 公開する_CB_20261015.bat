@echo off
chcp 932 >nul
cd /d %~dp0
echo ============================================
echo  CB入力と集計（第1段階）を公開します
echo  ※ファイルの差し替えと控えは済んでいます
echo ============================================
echo.
echo [1/2] ビルド中...
call npm run build
if errorlevel 1 (
  echo.
  echo ビルドに失敗しました。公開は行っていません。
  echo この画面を撮って送ってください。
  pause
  exit /b 1
)
echo.
echo [2/2] 公開中...
call firebase deploy --only hosting
if errorlevel 1 (
  echo.
  echo 公開に失敗しました。この画面を撮って送ってください。
  pause
  exit /b 1
)
echo.
echo ============================================
echo  公開が終わりました。
echo  スマホで実績報告を開き、CBありの報告をして
echo  ホームに赤い枠が出ることを確認してください。
echo ============================================
pause
