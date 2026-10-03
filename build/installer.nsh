; wickrunAI installer hooks, included by electron-builder (package.json build.nsis.include).

; The browser that wickrunAI opens for its browser tools uses a dedicated profile
; (<userData>\chrome-profile) and keeps running after wickrunAI quits. Releases up to
; 4.1.0 started it with the install folder as its working directory, and Windows cannot
; rename a folder that a running program uses as its working directory, so the update
; stopped with "Failed to uninstall old application files: 2".
;
; Only processes started with that dedicated profile are closed; the user's own browser
; windows use a different profile and are never touched. The match pattern is split in
; two so that this PowerShell command line itself never matches it.
!macro wickrunCloseDedicatedBrowser
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$p = '*user-data-dir=*\'; Get-CimInstance Win32_Process | Where-Object { $$_.ProcessId -ne $$PID -and ($$_.CommandLine -like ($$p + 'anyai\chrome-profile*') -or $$_.CommandLine -like ($$p + 'wickrunAI\chrome-profile*')) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  ; Give Windows a moment to release the folder handles.
  Sleep 500
!macroend

!macro customInit
  !insertmacro wickrunCloseDedicatedBrowser
!macroend

!macro customUnInit
  !insertmacro wickrunCloseDedicatedBrowser
!macroend
