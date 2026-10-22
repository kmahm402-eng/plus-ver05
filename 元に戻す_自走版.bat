@echo off
chcp 65001 > nul
cd /d C:\Users\ono\plus-ver05
echo 自走版を入れる前の状態に戻します（10/9の控えから）
copy /Y src\App.jsx.bak_20261009 src\App.jsx
copy /Y src\pages\Manage.jsx.bak_20261009 src\pages\Manage.jsx
copy /Y firestore.rules.bak_20261009 firestore.rules
echo.
echo 戻しました。続けて次の2つを実行すると、公開中の画面も元に戻ります。
echo   npm run build
echo   firebase deploy --only hosting,firestore:rules
pause
