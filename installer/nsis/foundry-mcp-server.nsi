; Foundry AI Tool client installer for a GM's Windows PC
; Built with NSIS (Nullsoft Scriptable Install System)
;
; Installs only what Claude Desktop needs: a portable Node.js and the MCP client. The bridge,
; Foundry and the Foundry module run on another machine (the home server); this installer asks
; where the bridge is and points Claude Desktop's five Foundry AI Tool entries at it.
;
; Silent install:  FoundryMCPServer-Setup-vX.Y.Z.exe /S /HOST=<name or IP> [/PORT=31414] [/D=<folder>]

SetCompressor /SOLID lzma

;--------------------------------
; Include Modern UI and helpers
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!insertmacro GetParameters
!insertmacro GetOptions

;--------------------------------
; General Configuration
Name "Foundry AI Tool Client"

; Allow output file to be overridden from command line
!ifndef OUTFILE
  !define OUTFILE "FoundryMCPServer-Setup.exe"
!endif
OutFile "${OUTFILE}"

Unicode True

; Default installation directory
InstallDir "$LOCALAPPDATA\FoundryMCPServer"

; Request application privileges (user level, no admin required)
RequestExecutionLevel user

; Version information
; Strip 'v' prefix and any suffix (like '-pre', '-alpha', etc.) from VERSION
!ifndef VERSION
  !define VERSION "v0.21.0"
!endif

; Process VERSION: remove 'v' prefix and everything after '-'
!searchparse /noerrors "${VERSION}" "v" STRIPPED_VERSION
!ifndef STRIPPED_VERSION
  !define STRIPPED_VERSION "${VERSION}"
!endif

!searchparse /noerrors "${STRIPPED_VERSION}" "" VERSION_BASE "-"
!ifndef VERSION_BASE
  !define VERSION_BASE "${STRIPPED_VERSION}"
!endif

VIProductVersion "${VERSION_BASE}.0"
VIAddVersionKey "ProductName" "Foundry AI Tool Client"
VIAddVersionKey "CompanyName" "Foundry MCP Bridge"
VIAddVersionKey "FileDescription" "Connects Claude Desktop to a Foundry AI Tool bridge"
VIAddVersionKey "FileVersion" "${VERSION_BASE}.0"
VIAddVersionKey "LegalCopyright" "(c) 2024 Foundry MCP Bridge"

;--------------------------------
; Interface Configuration
!define MUI_ABORTWARNING
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"

; Welcome page
!define MUI_WELCOMEPAGE_TITLE "Foundry AI Tool Client Setup"
!define MUI_WELCOMEPAGE_TEXT "This wizard connects Claude Desktop on this PC to your Foundry AI Tool bridge.$\r$\n$\r$\nThe bridge and Foundry run on another machine, so nothing else is installed here: a small client and the Node.js runtime it needs. You will be asked for the bridge address next.$\r$\n$\r$\nClick Next to continue."

; Directory page
!define MUI_DIRECTORYPAGE_TEXT_TOP "Choose the folder where you want to install the client."

; Finish page
!define MUI_FINISHPAGE_TITLE "Installation Complete"
!define MUI_FINISHPAGE_TEXT "The client is installed and Claude Desktop has five Foundry AI Tool connectors (Core, Play, Prep, Build, Admin).$\r$\n$\r$\nNext steps:$\r$\n$\r$\n1. Start Claude Desktop (it must have been closed while this ran)$\r$\n2. Make sure your private network (for example Tailscale) is connected$\r$\n3. Open the Search and tools menu and switch the connectors on$\r$\n$\r$\nFor help, see the GitHub repository."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open the Foundry AI Tool GitHub page"
!define MUI_FINISHPAGE_RUN_FUNCTION "OpenGitHub"

;--------------------------------
; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LICENSE.txt"
!insertmacro MUI_PAGE_DIRECTORY
Page custom BridgePageCreate BridgePageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

;--------------------------------
; Languages
!insertmacro MUI_LANGUAGE "English"

;--------------------------------
; Global Variables
Var Dialog
Var HostCtl
Var PortCtl
Var BridgeHost
Var BridgePort

;--------------------------------
; Initialization: defaults, the previous answer, then the command line
Function .onInit
  StrCpy $BridgeHost ""
  StrCpy $BridgePort "31414"

  ; Remember the previous answer so a reinstall or upgrade only needs Next
  ReadRegStr $0 HKCU "Software\FoundryMCPServer" "BridgeHost"
  ${If} $0 != ""
    StrCpy $BridgeHost $0
  ${EndIf}
  ReadRegStr $0 HKCU "Software\FoundryMCPServer" "BridgePort"
  ${If} $0 != ""
    StrCpy $BridgePort $0
  ${EndIf}

  ; /HOST= and /PORT= work for normal and silent installs
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/HOST=" $0
  ${IfNot} ${Errors}
    StrCpy $BridgeHost $0
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/PORT=" $0
  ${IfNot} ${Errors}
    StrCpy $BridgePort $0
  ${EndIf}
  ClearErrors

  ; A silent install has no address page, so the address must be right already
  IfSilent 0 init_done
    Call ValidateBridge
    ${If} $0 != ""
      SetErrorLevel 2
      Abort
    ${EndIf}
  init_done:
FunctionEnd

;--------------------------------
; Helper Functions
Function OpenGitHub
  ExecShell "open" "https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool"
FunctionEnd

; In:  $R0 = text, $R1 = the characters that are allowed
; Out: $R2 = "1" when every character of $R0 is in $R1, otherwise "0"
Function CharsAllowed
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  StrCpy $R2 "1"
  StrCpy $R3 0
  next_char:
    StrCpy $R4 $R0 1 $R3
    StrCmp $R4 "" chars_done
    StrCpy $R5 0
    next_allowed:
      StrCpy $R6 $R1 1 $R5
      StrCmp $R6 "" not_allowed
      StrCmpS $R6 $R4 is_allowed
      IntOp $R5 $R5 + 1
      Goto next_allowed
    is_allowed:
    IntOp $R3 $R3 + 1
    Goto next_char
  not_allowed:
    StrCpy $R2 "0"
  chars_done:
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
FunctionEnd

; Checks $BridgeHost and $BridgePort. Out: $0 = "" when fine, otherwise the message to show.
Function ValidateBridge
  StrCpy $0 ""

  StrLen $1 "$BridgeHost"
  ${If} $1 == 0
    StrCpy $0 "Enter the bridge address: a host name or IP address, for example the name of the server on your private network."
    Return
  ${EndIf}
  ; A host name or IPv4 address (letters, digits, dots, dashes), or an IPv6 literal in brackets
  StrCpy $2 "$BridgeHost" 1
  ${If} $2 == "["
    StrCpy $3 "$BridgeHost" 1 -1
    ${If} $3 != "]"
      StrCpy $0 "An IPv6 address must be written in brackets, like [fd7a::1]."
      Return
    ${EndIf}
    StrCpy $R0 "$BridgeHost" "" 1
    StrCpy $R0 "$R0" -1
    StrCpy $R1 "0123456789abcdefABCDEF:."
  ${Else}
    StrCpy $R0 "$BridgeHost"
    StrCpy $R1 "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-"
  ${EndIf}
  Call CharsAllowed
  StrLen $1 "$R0"
  ${If} $R2 != "1"
  ${OrIf} $1 == 0
    StrCpy $0 "The bridge address may only contain letters, digits, dots and dashes (or an IPv6 address in brackets). No spaces, quotes or other characters."
    Return
  ${EndIf}

  StrLen $1 "$BridgePort"
  ${If} $1 == 0
    StrCpy $BridgePort "31414"
  ${EndIf}
  StrLen $1 "$BridgePort"
  StrCpy $R0 "$BridgePort"
  StrCpy $R1 "0123456789"
  Call CharsAllowed
  StrCpy $2 "$BridgePort" 1
  ${If} $R2 != "1"
  ${OrIf} $1 > 5
  ${OrIf} $2 == "0"
    StrCpy $0 "The port must be a number between 1 and 65535 without a leading zero (the default is 31414)."
    Return
  ${EndIf}
  ${If} $BridgePort < 1
  ${OrIf} $BridgePort > 65535
    StrCpy $0 "The port must be a number between 1 and 65535 (the default is 31414)."
    Return
  ${EndIf}
FunctionEnd

; The bridge address page
Function BridgePageCreate
  !insertmacro MUI_HEADER_TEXT "Bridge address" "Where does your Foundry AI Tool bridge run?"

  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 36u "Enter the name or IP address of the machine that runs the bridge, for example the server's name on your private network (Tailscale). The port is almost always 31414."
  Pop $0

  ${NSD_CreateLabel} 0 44u 100% 10u "Bridge address (host name or IP address):"
  Pop $0
  ${NSD_CreateText} 0 56u 100% 12u "$BridgeHost"
  Pop $HostCtl

  ${NSD_CreateLabel} 0 78u 100% 10u "Port:"
  Pop $0
  ${NSD_CreateText} 0 90u 40u 12u "$BridgePort"
  Pop $PortCtl

  nsDialogs::Show
FunctionEnd

Function BridgePageLeave
  ${NSD_GetText} $HostCtl $BridgeHost
  ${NSD_GetText} $PortCtl $BridgePort
  Call ValidateBridge
  ${If} $0 != ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "$0"
    Abort
  ${EndIf}
FunctionEnd

; Writes the five Claude Desktop entries. Claude Desktop rewrites its settings when it quits, so it
; must be closed first; we ask and retry, we never close it ourselves.
Function UpdateClaudeConfig
  DetailPrint "Configuring Claude Desktop (bridge $BridgeHost:$BridgePort)..."

  config_try:
    StrCpy $2 ""
    ${If} ${Silent}
      StrCpy $2 "-WaitSeconds 120"
    ${EndIf}
    nsExec::ExecToStack 'powershell.exe -inputformat none -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\configure-claude.ps1" -InstallDir "$INSTDIR" -BridgeHost "$BridgeHost" -BridgePort "$BridgePort" $2'
    Pop $0 ; exit code
    Pop $1 ; output
    DetailPrint "$1"

    ${If} $0 == 0
      DetailPrint "Claude Desktop configured. Restart it to load the new connectors."
      Return
    ${EndIf}

    ${If} $0 == 3
      DetailPrint "Claude Desktop is still running."
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Claude Desktop is running.$\r$\n$\r$\nIt rewrites its settings when it closes, which would undo this change. Quit it completely (right-click its icon in the system tray, then Quit) and click Retry.$\r$\n$\r$\nCancel skips the Claude Desktop step; run this installer again later to finish." /SD IDCANCEL IDRETRY config_try
      SetErrorLevel 3
      DetailPrint "Skipped: Claude Desktop was still running. Run the installer again after quitting it."
      Return
    ${EndIf}

    SetErrorLevel 1
    DetailPrint "Claude Desktop configuration failed (exit code $0). Log: $TEMP\foundry-mcp-claude-config.log"
    MessageBox MB_ICONEXCLAMATION|MB_OK "The client was installed, but Claude Desktop could not be configured (code $0).$\r$\n$\r$\nDetails: $TEMP\foundry-mcp-claude-config.log$\r$\n$\r$\nRun this installer again, or ask for help." /SD IDOK
FunctionEnd

;--------------------------------
; Installer Section
Section "Foundry AI Tool Client" SecMain
  SetOutPath $INSTDIR

  ; Remove what older installers put here (local backend, Foundry module helpers)
  ; Only in a folder that holds our own earlier install (it has our Uninstall.exe), never in an
  ; arbitrary folder the user typed.
  IfFileExists "$INSTDIR\Uninstall.exe" 0 skip_legacy_cleanup
    DetailPrint "Cleaning up files from older versions..."
    RMDir /r "$INSTDIR\foundry-mcp-server"
    RMDir /r "$INSTDIR\node"
    RMDir /r "$INSTDIR\node_modules"
    Delete "$INSTDIR\start-server.bat"
    Delete "$INSTDIR\test-connection.bat"
    Delete "$INSTDIR\configure-claude-wrapper.bat"
    RMDir /r "$SMPROGRAMS\Foundry MCP Server"
  skip_legacy_cleanup:

  ; Node.js runtime (only node.exe is needed to run the client)
  DetailPrint "Installing Node.js runtime..."
  File "node.exe"
  File /nonfatal "node-LICENSE.txt"

  ; The MCP client that Claude Desktop starts
  DetailPrint "Installing the client..."
  SetOutPath "$INSTDIR\foundry-mcp-client"
  File "foundry-mcp-client\index.cjs"
  SetOutPath $INSTDIR

  File "README.txt"
  File "LICENSE.txt"
  File "icon.ico"
  File "configure-claude.ps1"

  ; Remember the address for the next run
  WriteRegStr HKCU "Software\FoundryMCPServer" "BridgeHost" "$BridgeHost"
  WriteRegStr HKCU "Software\FoundryMCPServer" "BridgePort" "$BridgePort"

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\Foundry AI Tool Client"
  CreateShortcut "$SMPROGRAMS\Foundry AI Tool Client\Uninstall.lnk" "$INSTDIR\Uninstall.exe"

  ; Add to Windows Programs list
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer" "DisplayName" "Foundry AI Tool Client"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer" "Publisher" "Foundry MCP Bridge"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer" "DisplayVersion" "0.21.0"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer" "NoRepair" 1

  Call UpdateClaudeConfig
  DetailPrint "Done."
SectionEnd

;--------------------------------
; Uninstaller

; Removes only the five Foundry AI Tool entries from Claude Desktop's config files.
Function un.RemoveClaudeConfig
  DetailPrint "Removing the Foundry AI Tool entries from Claude Desktop..."

  remove_try:
    StrCpy $2 ""
    ${If} ${Silent}
      StrCpy $2 "-WaitSeconds 120"
    ${EndIf}
    nsExec::ExecToStack 'powershell.exe -inputformat none -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\configure-claude.ps1" -Uninstall $2'
    Pop $0
    Pop $1
    DetailPrint "$1"

    ${If} $0 == 0
      DetailPrint "Claude Desktop entries removed. Restart Claude Desktop."
      Return
    ${EndIf}

    ${If} $0 == 3
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Claude Desktop is running.$\r$\n$\r$\nQuit it completely (right-click its icon in the system tray, then Quit) and click Retry. Cancel leaves the Foundry AI Tool entries in place; remove them in Claude Desktop's settings if you want them gone." /SD IDCANCEL IDRETRY remove_try
      DetailPrint "Skipped: Claude Desktop was still running."
      Return
    ${EndIf}

    DetailPrint "Could not update Claude Desktop (exit code $0). Log: $TEMP\foundry-mcp-claude-config.log"
    MessageBox MB_ICONEXCLAMATION|MB_OK "Could not remove the Foundry AI Tool entries from Claude Desktop (code $0).$\r$\n$\r$\nDetails: $TEMP\foundry-mcp-claude-config.log$\r$\n$\r$\nThe entries are named foundry-mcp, foundry-mcp-play, foundry-mcp-prep, foundry-mcp-build and foundry-mcp-admin. A backup of each config file was made before any change." /SD IDOK
FunctionEnd

Section "Uninstall"
  DetailPrint "Starting uninstallation..."

  MessageBox MB_YESNO "Do you want to remove the five Foundry AI Tool entries from your Claude Desktop configuration?$\r$\n$\r$\n(Recommended. Your other connectors are not touched.)" /SD IDYES IDYES do_remove_config IDNO skip_config
  do_remove_config:
    Call un.RemoveClaudeConfig
  skip_config:

  DetailPrint "Removing files..."
  Delete "$INSTDIR\node.exe"
  Delete "$INSTDIR\node-LICENSE.txt"
  RMDir /r "$INSTDIR\foundry-mcp-client"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\configure-claude.ps1"
  Delete "$INSTDIR\icon.ico"

  ; Files and folders left by older versions, only where our own Uninstall.exe lives
  IfFileExists "$INSTDIR\Uninstall.exe" 0 skip_legacy_removal
    RMDir /r "$INSTDIR\foundry-mcp-server"
    RMDir /r "$INSTDIR\node"
    RMDir /r "$INSTDIR\node_modules"
    Delete "$INSTDIR\configure-claude-wrapper.bat"
    Delete "$INSTDIR\start-server.bat"
    Delete "$INSTDIR\test-connection.bat"
    Delete "$INSTDIR\THIRD_PARTY_NOTICES.txt"
    Delete "$INSTDIR\start-comfyui.bat"
    Delete "$INSTDIR\test-comfyui.bat"
    RMDir /r "$INSTDIR\ComfyUI"
    RMDir /r "$SMPROGRAMS\Foundry MCP Server"
  skip_legacy_removal:

  RMDir /r "$SMPROGRAMS\Foundry AI Tool Client"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer"
  DeleteRegKey HKCU "Software\FoundryMCPServer"

  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  DetailPrint "Uninstallation completed."
  MessageBox MB_ICONINFORMATION "The Foundry AI Tool client has been removed.$\r$\n$\r$\nIf you removed the Claude Desktop entries, restart Claude Desktop." /SD IDOK
SectionEnd
