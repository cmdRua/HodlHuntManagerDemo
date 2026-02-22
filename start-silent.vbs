Set WshShell = CreateObject("WScript.Shell")
Dim scriptDir
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
WshShell.Run "cmd /c cd /d " & Chr(34) & scriptDir & Chr(34) & " && node_modules\.bin\electron.cmd .", 0, False
