@echo off
chcp 932 >nul
cd /d C:\Users\ono\plus-ver05 || goto err
echo CB第2弾を元に戻します（第1段階の状態へ）
if not exist src\pages\Report.jsx.bak_cb2_20261015 ( echo 控え（.bak_cb2_20261015）がありません。第2弾は反映されていないので、戻す必要はありません。 & pause & exit /b 0 )
copy /Y src\pages\Report.jsx.bak_cb2_20261015 src\pages\Report.jsx >nul || goto err
copy /Y src\pages\CbSummary.jsx.bak_cb2_20261015 src\pages\CbSummary.jsx >nul || goto err
copy /Y src\components\CbTodo.jsx.bak_cb2_20261015 src\components\CbTodo.jsx >nul || goto err
copy /Y src\pages\Home.jsx.bak_cb2_20261015 src\pages\Home.jsx >nul || goto err
echo [1/2] ビルド中...
call npm run build
if errorlevel 1 ( echo ビルドに失敗しました。この画面を撮って送ってください。 & pause & exit /b 1 )
echo [2/2] 公開中...
call firebase deploy --only hosting
if errorlevel 1 ( echo 公開に失敗しました。この画面を撮って送ってください。 & pause & exit /b 1 )
echo.
echo 元に戻しました（第1段階の状態）。
echo さらに10/4公開版まで戻すときは、plus-ver05 内の 元に戻す_CB_20261015.bat を実行してください。
pause
exit /b 0
:err
echo 途中で止まりました。この画面を撮って送ってください。
pause
exit /b 1
