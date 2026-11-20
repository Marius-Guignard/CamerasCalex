@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Premiere installation, patiente quelques minutes...
  call npm install
)
call npm start
