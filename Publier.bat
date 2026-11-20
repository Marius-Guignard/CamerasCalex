@echo off
cd /d "%~dp0"
echo Publication d'une nouvelle version : toutes les applis se mettront a jour a leur prochaine ouverture.
echo.
git fetch --tags
for /f "delims=" %%n in ('node scripts\version.js') do set NEW=%%n
echo Nouvelle version : %NEW%
git add .
git commit -m "Version %NEW%"
git tag v%NEW%
git push
git push origin v%NEW%
echo.
echo Termine. GitHub fabrique l'installateur (2 a 3 minutes).
pause
