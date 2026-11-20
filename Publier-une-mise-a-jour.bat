@echo off
cd /d "%~dp0"
echo Publication d'une nouvelle version : toutes les applis se mettront a jour a leur prochaine ouverture.
git add .
git commit -m "Mise a jour"
call npm version patch
git push
git push --tags
echo.
echo Termine. GitHub fabrique l'installateur (5 a 10 minutes).
pause
