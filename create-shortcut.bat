@echo off
:: Creates a desktop shortcut for HodlHunt Manager
:: Run this script ONCE after npm install

set SCRIPT_DIR=%~dp0
set SHORTCUT_NAME=HodlHunt Manager
set DESKTOP=%USERPROFILE%\Desktop
set VBS_LAUNCHER=%SCRIPT_DIR%start-silent.vbs
set ICON=%SCRIPT_DIR%renderer\icon.ico

powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$sc = $ws.CreateShortcut('%DESKTOP%\%SHORTCUT_NAME%.lnk'); " ^
  "$sc.TargetPath = 'wscript.exe'; " ^
  "$sc.Arguments = '\""%VBS_LAUNCHER%\""'; " ^
  "$sc.IconLocation = '%ICON%'; " ^
  "$sc.WorkingDirectory = '%SCRIPT_DIR%'; " ^
  "$sc.Description = 'HodlHunt Manager'; " ^
  "$sc.Save()"

echo.
echo [OK] Ярлык создан: %DESKTOP%\%SHORTCUT_NAME%.lnk
echo.
pause
