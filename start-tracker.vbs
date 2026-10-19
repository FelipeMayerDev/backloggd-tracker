' Runs the tracker hidden from this script's folder, logging to tracker.log.
' Put a shortcut to this file in shell:startup to start it at logon.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "cmd /c cd /d """ & dir & """ && node --env-file=.env tracker.mjs >> tracker.log 2>&1", 0, False
