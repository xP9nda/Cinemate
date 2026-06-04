; Custom NSIS script for the Cinemate installer.
;
; Adds a "data location" page after the install-directory page so the user can
; choose where their library/settings live, independent of the program files.
; The chosen path is written to meta.json in the app's userData folder
; (%APPDATA%\Cinemate\meta.json), which the main process reads on startup
; (see getDataDir() in src/main/index.ts).

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WordFunc.nsh"
!insertmacro WordReplace

; --- Custom page: choose data directory (shown after the install-dir page) ---
!macro customPageAfterChangeDir
  Page custom DataDirPageCreate DataDirPageLeave
!macroend

; The page functions are only referenced by the installer; the uninstaller
; build compiles this same include, so guard them to avoid "unreferenced
; function" warnings (which electron-builder treats as errors).
!ifndef BUILD_UNINSTALLER

Var DataDirDialog
Var DataDirText
Var DataDir

Function DataDirPageCreate
  ; On upgrade/reinstall, meta.json already exists - keep the user's existing
  ; data location and skip this page so we never clobber their config.
  ${If} ${FileExists} "$APPDATA\${PRODUCT_NAME}\meta.json"
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $DataDirDialog
  ${If} $DataDirDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 30u "Select the folder where your movie & TV data will be saved. \
This is kept separate from the program files, so your data is preserved if you reinstall, update, or uninstall the app."
  Pop $0

  ${If} $DataDir == ""
    StrCpy $DataDir "$APPDATA\${PRODUCT_NAME}\data"
  ${EndIf}

  ${NSD_CreateDirRequest} 0 44u 74% 12u "$DataDir"
  Pop $DataDirText

  ${NSD_CreateBrowseButton} 76% 43u 24% 14u "Browse..."
  Pop $0
  ${NSD_OnClick} $0 DataDirBrowse

  nsDialogs::Show
FunctionEnd

Function DataDirBrowse
  ${NSD_GetText} $DataDirText $0
  nsDialogs::SelectFolderDialog "Select data folder" "$0"
  Pop $1
  ${If} $1 != error
    ${NSD_SetText} $DataDirText "$1"
  ${EndIf}
FunctionEnd

Function DataDirPageLeave
  ${NSD_GetText} $DataDirText $DataDir
  ${If} $DataDir == ""
    MessageBox MB_ICONEXCLAMATION "Please choose a data folder."
    Abort ; stay on the page
  ${EndIf}
FunctionEnd

!endif ; BUILD_UNINSTALLER

; --- Persist the chosen data directory to meta.json during install ---
!macro customInstall
  ${If} $DataDir != ""
    ; Use forward slashes so the value is valid JSON without escaping.
    ; Node's path.resolve() normalizes them back to "\" on Windows.
    ${WordReplace} "$DataDir" "\" "/" "+" $0
    CreateDirectory "$DataDir"
    CreateDirectory "$APPDATA\${PRODUCT_NAME}"
    FileOpen $1 "$APPDATA\${PRODUCT_NAME}\meta.json" w
    FileWrite $1 '{$\r$\n  "dataDir": "$0"$\r$\n}$\r$\n'
    FileClose $1
  ${EndIf}
!macroend
