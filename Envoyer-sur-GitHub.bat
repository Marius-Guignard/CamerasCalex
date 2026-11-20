@echo off
cd /d "%~dp0"
echo Premier envoi du projet sur GitHub...
if not exist .github\workflows mkdir .github\workflows
if exist publier.yml move /Y publier.yml .github\workflows\publier.yml
git init
git add .
git commit -m "Premiere version"
git branch -M main
git remote add origin https://github.com/Marius-Guignard/CamerasCalex.git
git push -u origin main
git tag v1.0.0
git push origin v1.0.0
echo.
echo Termine. GitHub fabrique maintenant l'installateur (5 a 10 minutes).
pause
