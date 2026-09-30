; Foundry MCP Server Windows Installer
; Built with NSIS (Nullsoft Scriptable Install System)

;--------------------------------
; Include Modern UI and PowerShell support
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "Sections.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; PowerShell execution macro - fixed for NSIS/PowerShell compatibility
!macro PowerShellExecWithOutput command
  nsExec::ExecToStack 'powershell.exe -inputformat none -NoProfile -ExecutionPolicy Bypass -Command "${command}"'
!macroend

!define PowerShellExecWithOutput "!insertmacro PowerShellExecWithOutput"

; PowerShell file execution macro
!macro PowerShellExecFile filepath parameters
  nsExec::ExecToStack 'powershell.exe -inputformat none -NoProfile -ExecutionPolicy Bypass -File "${filepath}" ${parameters}'
!macroend

!define PowerShellExecFile "!insertmacro PowerShellExecFile"

;--------------------------------
; General Configuration
Name "Foundry MCP Server"

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
  !define VERSION "v0.18.0"
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
VIAddVersionKey "ProductName" "Foundry MCP Server"
VIAddVersionKey "CompanyName" "Foundry MCP Bridge"
VIAddVersionKey "FileDescription" "AI-powered campaign management for Foundry VTT"
VIAddVersionKey "FileVersion" "${VERSION_BASE}.0"
VIAddVersionKey "LegalCopyright" "© 2024 Foundry MCP Bridge"

;--------------------------------
; Interface Configuration
!define MUI_ABORTWARNING
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"

; Welcome page
!define MUI_WELCOMEPAGE_TITLE "Foundry MCP Server Setup"
!define MUI_WELCOMEPAGE_TEXT "This wizard will install Foundry MCP Server, which enables AI-powered campaign management for Foundry VTT using Claude Desktop.$\r$\n$\r$\nOptionally install the Foundry MCP Bridge module directly to your system for seamless setup.$\r$\n$\r$\nClick Next to continue."

; Directory page
!define MUI_DIRECTORYPAGE_TEXT_TOP "Choose the folder where you want to install Foundry MCP Server."

; Components page
!define MUI_COMPONENTSPAGE_TEXT_TOP "Select the components you want to install:"
!define MUI_COMPONENTSPAGE_TEXT_COMPLIST "Check the components you want to install and uncheck the components you don't want to install. Click Next to continue."

; Finish page (will be customized based on what was installed)
!define MUI_FINISHPAGE_TITLE "Installation Complete"
!define MUI_FINISHPAGE_TEXT_NOREBOOTSUPPORT
!define MUI_FINISHPAGE_TEXT "Thank you for installing Foundry MCP Server!$\r$\n$\r$\nNext steps:$\r$\n$\r$\n1. Restart Claude Desktop$\r$\n2. Launch Foundry VTT$\r$\n$\r$\nIf the Foundry module was installed, it will be available in your modules list. Otherwise, install the MCP Bridge module manually.$\r$\n$\r$\nFor support and documentation, visit our GitHub repository."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open Foundry VTT MCP GitHub"
!define MUI_FINISHPAGE_RUN_FUNCTION "OpenGitHub"

;--------------------------------
; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LICENSE.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

;--------------------------------
; Languages
!insertmacro MUI_LANGUAGE "English"

;--------------------------------
; Global Variables
Var FoundryPath
Var ClaudeConfigPath
Var FoundryDetectionResult
Var InstallationSuccess

; Uninstaller Variables
Var un.FoundryPath
Var un.ClaudeConfigPath

;--------------------------------
; Initialization Function
Function .onInit
  ; Initialize installation success flag
  StrCpy $InstallationSuccess "false"

  ; Set Foundry module section as checked by default
  !insertmacro SelectSection SecFoundryModule
FunctionEnd

Function DetectFoundryInstallation
  ; Initialize variables
  StrCpy $FoundryPath ""
  StrCpy $FoundryDetectionResult ""
  
  ; Check if user has Claude Desktop (good sign they'll want this integration)
  StrCpy $ClaudeConfigPath "$APPDATA\Claude\claude_desktop_config.json"
  IfFileExists "$ClaudeConfigPath" claude_detected no_claude
  
  claude_detected:
  DetailPrint "Claude Desktop detected - looking for Foundry VTT installation..."
  StrCpy $FoundryDetectionResult "Claude Desktop found"
  Goto check_foundry_paths
  
  no_claude:
  DetailPrint "Claude Desktop not detected - checking for Foundry VTT anyway..."
  StrCpy $FoundryDetectionResult "No Claude Desktop"
  
  check_foundry_paths:
  ; Try primary location first
  StrCpy $FoundryPath "$LOCALAPPDATA\FoundryVTT\Data\modules"
  IfFileExists "$FoundryPath" foundry_found
  DetailPrint "Primary Foundry path not found: $FoundryPath"
  
  ; Try secondary location  
  StrCpy $FoundryPath "$APPDATA\FoundryVTT\Data\modules"
  IfFileExists "$FoundryPath" foundry_found
  DetailPrint "Secondary Foundry path not found: $FoundryPath"
  
  ; Check environment variable
  ReadEnvStr $0 "FOUNDRY_VTT_DATA_PATH"
  StrCmp $0 "" check_manual
  StrCpy $FoundryPath "$0\Data\modules"
  IfFileExists "$FoundryPath" foundry_found
  DetailPrint "Environment variable path not found: $FoundryPath"
  
  check_manual:
  ; If all else fails, show folder browser
  MessageBox MB_YESNO "Foundry VTT not detected automatically.$\r$\n$\r$\nWould you like to browse for your Foundry User Data folder?$\r$\n$\r$\n(Usually located at: $LOCALAPPDATA\FoundryVTT)" IDYES browse_for_foundry IDNO skip_module
  
  browse_for_foundry:
  nsDialogs::SelectFolderDialog "Select Foundry VTT User Data Folder (containing Data subfolder)" "$LOCALAPPDATA"
  Pop $0
  StrCmp $0 CANCEL skip_module
  
  ; Validate selection has Data\modules subfolder
  StrCpy $FoundryPath "$0\Data\modules"
  IfFileExists "$FoundryPath" foundry_found
  
  ; Try alternative - maybe they selected the Data folder directly
  StrCpy $FoundryPath "$0\modules"  
  IfFileExists "$FoundryPath" foundry_found
  
  ; Final error if invalid selection
  MessageBox MB_ICONSTOP "Selected folder does not contain a valid Foundry VTT Data structure.$\r$\n$\r$\nExpected: [Selected Folder]\Data\modules\$\r$\n$\r$\nModule installation cancelled."
  Goto skip_module
  
  skip_module:
  DetailPrint "Foundry module installation will be skipped"
  StrCpy $FoundryPath ""
  Return
  
  foundry_found:
  DetailPrint "Foundry VTT installation detected at: $FoundryPath"
  StrCpy $FoundryDetectionResult "$FoundryDetectionResult; Foundry found at $FoundryPath"
FunctionEnd

;--------------------------------
; Helper Functions
Function OpenGitHub
  ExecShell "open" "https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool"
FunctionEnd

Function .onGUIEnd
  ; Simply mark installation as successful if registry entry exists
  ; No popup dialogs - information is shown on the finish page instead
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer" "DisplayName"
  StrCmp $0 "" installation_failed installation_success

  installation_success:
  StrCpy $InstallationSuccess "true"
  Return

  installation_failed:
  ; Installation was cancelled or failed - don't set success flag
  Return
FunctionEnd

Function UpdateClaudeConfig
  ; Configure Claude Desktop using PowerShell script
  DetailPrint "Configuring Claude Desktop..."
  
  ; First test if PowerShell is available
  DetailPrint "Testing PowerShell availability..."
  ${PowerShellExecWithOutput} 'Write-Host "PowerShell OK"'
  Pop $0 ; Exit code
  Pop $1 ; Output
  
  IntCmp $0 0 powershell_ok powershell_failed powershell_failed
  
  powershell_failed:
    DetailPrint "PowerShell test failed (exit code: $0)"
    MessageBox MB_ICONEXCLAMATION|MB_OK "PowerShell Not Available$\r$\n$\r$\nFoundry MCP Server installed successfully, but PowerShell is required for automatic Claude Desktop configuration.$\r$\n$\r$\n- See manual setup guide in Start Menu$\r$\n- Configure Claude Desktop manually$\r$\n- Contact support if PowerShell should be available"
    Goto config_done
    
  powershell_ok:
    DetailPrint "PowerShell available, executing configuration script..."
    
    ; Execute PowerShell script with installation directory as parameter
    ${PowerShellExecFile} "$INSTDIR\configure-claude.ps1" '"-InstallDir \"$INSTDIR\""'
    Pop $0 ; Exit code
    Pop $1 ; Output/Error messages
    
    ; Check if PowerShell script succeeded
    IntCmp $0 0 config_success config_failed config_failed
    
    config_failed:
      DetailPrint "Direct PowerShell execution failed (exit code: $0)"
      DetailPrint "PowerShell output: $1"
      
      ; Try batch file fallback method
      DetailPrint "Attempting batch file fallback method..."
      nsExec::ExecToStack '"$INSTDIR\configure-claude-wrapper.bat" "$INSTDIR"'
      Pop $5 ; Exit code from batch
      Pop $6 ; Output from batch
      
      IntCmp $5 0 batch_success batch_failed batch_failed
      
      batch_success:
        DetailPrint "Batch fallback method succeeded"
        DetailPrint "Batch output: $6"
        Goto config_success
        
      batch_failed:
        DetailPrint "Batch fallback method also failed (exit code: $5)"
        DetailPrint "Batch output: $6"
        
        ; Extract useful error message from PowerShell output
        StrLen $2 "$1"
        IntCmp $2 0 no_output has_output has_output
        
        no_output:
          StrCpy $3 "No error details available"
          Goto show_error
          
        has_output:
          ; Truncate long output for message box (first 200 chars)
          StrLen $4 "$1"
          IntCmp $4 200 show_full truncate_output show_full
          
          truncate_output:
            StrCpy $3 "$1" 200
            StrCpy $3 "$3..."
            Goto show_error
            
          show_full:
            StrCpy $3 "$1"
            
        show_error:
          ; Extract the first line of the error for a cleaner display
          StrCpy $7 $3 80 ; First 80 characters
          StrCmp $3 $7 short_error 0
          StrCpy $7 "$7..."
          
          short_error:
          ${If} $InstallationSuccess == "true"
            MessageBox MB_ICONEXCLAMATION|MB_OK "Claude Desktop Configuration Failed$\r$\n$\r$\nError: $7$\r$\n$\r$\nFoundry MCP Server installed successfully, but Claude Desktop configuration could not be completed automatically.$\r$\n$\r$\n- Check detailed error log: %TEMP%\foundry-mcp-claude-config.log$\r$\n- See manual setup guide in Start Menu$\r$\n- Restart Claude Desktop after manual configuration"
          ${Else}
            MessageBox MB_ICONEXCLAMATION|MB_OK "Claude Desktop Configuration Failed$\r$\n$\r$\nError: $7$\r$\n$\r$\nInstallation was not completed successfully.$\r$\n$\r$\n- Check detailed error log: %TEMP%\foundry-mcp-claude-config.log$\r$\n- Try running the installer again"
          ${EndIf}
          Goto config_done
        
    config_success:
      DetailPrint "Claude Desktop configured successfully"
      
  config_done:
FunctionEnd

;--------------------------------
; Installer Sections
Section "Foundry MCP Server" SecMain
  SectionIn RO ; Read-only section (required)
  ; Set estimated size: Node.js runtime + MCP server + shared components (~32MB)
  SectionSetSize ${SecMain} 32768

  ; Set output path
  SetOutPath $INSTDIR
  
  ; Install Node.js runtime
  DetailPrint "Installing Node.js runtime..."
  File /r "node\"
  File "node.exe"
  
  ; Install MCP Server files  
  DetailPrint "Installing MCP Server..."
  SetOutPath "$INSTDIR\foundry-mcp-server"
  File /r "foundry-mcp-server\*"
  SetOutPath "$INSTDIR"
  
  ; Install documentation
  File "README.txt"
  File "LICENSE.txt"
  
  ; Install icon for uninstaller
  File "icon.ico"
  
  ; Install PowerShell configuration script and batch wrapper
  File "configure-claude.ps1"
  File "configure-claude-wrapper.bat"
  
  ; Create uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  
  ; Create Start Menu shortcuts (minimal set to avoid confusion)
  CreateDirectory "$SMPROGRAMS\Foundry MCP Server"
  CreateShortcut "$SMPROGRAMS\Foundry MCP Server\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  
  ; Add to Windows Programs list
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer" "DisplayName" "Foundry MCP Server"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer" "Publisher" "Foundry MCP Bridge"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer" "DisplayVersion" "0.18.0"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer" "NoRepair" 1
  
  ; Create utility scripts
  DetailPrint "Creating utility scripts..."
  
  ; Start server script
  FileOpen $0 "$INSTDIR\start-server.bat" w
  FileWrite $0 '@echo off$\r$\n'
  FileWrite $0 'echo Starting Foundry MCP Server...$\r$\n'
  FileWrite $0 'cd /d "$INSTDIR"$\r$\n'
  FileWrite $0 '"$INSTDIR\node.exe" "$INSTDIR\foundry-mcp-server\packages\mcp-server\dist\index.cjs"$\r$\n'
  FileWrite $0 'pause$\r$\n'
  FileClose $0
  
  ; Test connection script
  FileOpen $0 "$INSTDIR\test-connection.bat" w
  FileWrite $0 '@echo off$\r$\n'
  FileWrite $0 'echo Testing Foundry MCP Server installation...$\r$\n'
  FileWrite $0 'echo.$\r$\n'
  FileWrite $0 'echo Checking Node.js...$\r$\n'
  FileWrite $0 '"$INSTDIR\node.exe" --version$\r$\n'
  FileWrite $0 'echo.$\r$\n'
  FileWrite $0 'echo Checking MCP Server files...$\r$\n'
  FileWrite $0 'if exist "$INSTDIR\foundry-mcp-server\packages\mcp-server\dist\index.cjs" ($\r$\n'
  FileWrite $0 '  echo ✓ MCP Server files found$\r$\n'
  FileWrite $0 ') else ($\r$\n'
  FileWrite $0 '  echo ✗ MCP Server files missing$\r$\n'
  FileWrite $0 ')$\r$\n'
  FileWrite $0 'echo.$\r$\n'
  FileWrite $0 'echo Installation test complete!$\r$\n'
  FileWrite $0 'pause$\r$\n'
  FileClose $0
  
  ; Update Claude Desktop configuration
  DetailPrint "Configuring Claude Desktop..."
  Call UpdateClaudeConfig
  
  ; Success message
  DetailPrint "Foundry MCP Server installation complete!"
  
SectionEnd

;--------------------------------
; Foundry Module Installation Section
Section "Foundry MCP Bridge" SecFoundryModule
  ; This section is checked by default
  ; Set estimated size: Compiled JS + assets + templates (~5MB)
  SectionSetSize ${SecFoundryModule} 5120

  ; Detect Foundry installation
  DetailPrint "Detecting Foundry VTT installation..."
  Call DetectFoundryInstallation
  
  ; Check if we found a valid Foundry path
  StrCmp $FoundryPath "" module_skipped module_install
  
  module_install:
  DetailPrint "Installing Foundry MCP Bridge Module to: $FoundryPath\foundry-mcp-bridge"
  
  ; Check if module already exists
  IfFileExists "$FoundryPath\foundry-mcp-bridge\module.json" existing_module new_install
  
  existing_module:
  DetailPrint "Existing module installation found - updating files..."
  Goto do_install
  
  new_install:
  DetailPrint "Installing fresh Foundry MCP Bridge module..."
  
  do_install:
  ; Create module directory
  CreateDirectory "$FoundryPath\foundry-mcp-bridge"
  SetOutPath "$FoundryPath\foundry-mcp-bridge"
  SetOverwrite on
  
  ; Copy all module files
  File /r "foundry-module\*"
  
  DetailPrint "Foundry MCP Bridge Module installed successfully"
  Goto module_done
  
  module_skipped:
  DetailPrint "Foundry module installation was skipped"
  
  module_done:
SectionEnd

;--------------------------------
; Section Descriptions
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "The core Foundry MCP Server that connects Claude Desktop to Foundry VTT. Includes Node.js runtime and MCP server. Required component (~32MB)."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecFoundryModule} "Install the Foundry MCP Bridge module directly to your Foundry VTT for seamless AI-powered campaign management. Includes compiled JavaScript, templates, and assets (~5MB)."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

;--------------------------------
; Uninstaller Section
Section "Uninstall"
  
  DetailPrint "Starting Foundry MCP Server uninstallation..."
  
  ; Remove MCP Server files and directories
  DetailPrint "Removing MCP Server files..."
  Delete "$INSTDIR\node.exe"
  RMDir /r "$INSTDIR\node"
  RMDir /r "$INSTDIR\node_modules"
  RMDir /r "$INSTDIR\foundry-mcp-server"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\configure-claude.ps1"
  Delete "$INSTDIR\configure-claude-wrapper.bat"
  Delete "$INSTDIR\start-server.bat"
  Delete "$INSTDIR\test-connection.bat"
  Delete "$INSTDIR\THIRD_PARTY_NOTICES.txt"
  Delete "$INSTDIR\icon.ico"

  ; Legacy cleanup: installers before this release offered an optional ComfyUI
  ; map-generation component (about 15 GB). Remove it if an old install left it.
  Delete "$INSTDIR\start-comfyui.bat"
  Delete "$INSTDIR\test-comfyui.bat"
  RMDir /r "$INSTDIR\ComfyUI"

  ; Remove any remaining files in installation directory
  Delete "$INSTDIR\*.*"
  
  ; Remove Start Menu shortcuts
  DetailPrint "Removing Start Menu shortcuts..."
  RMDir /r "$SMPROGRAMS\Foundry MCP Server"
  
  ; Remove registry entries
  DetailPrint "Removing registry entries..."
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer"
  
  ; Ask about Foundry module removal
  MessageBox MB_YESNO "Do you want to remove the Foundry MCP Bridge module from your Foundry VTT installation?$\r$\n$\r$\n(This will not affect your worlds, actors, or other Foundry data)" IDYES remove_foundry_module IDNO skip_foundry_removal
  
  remove_foundry_module:
  DetailPrint "Checking for Foundry module installation..."
  Call un.DetectFoundryModule
  StrCmp $un.FoundryPath "" foundry_not_found remove_foundry_files
  
  remove_foundry_files:
  DetailPrint "Removing Foundry MCP Bridge module from: $un.FoundryPath"
  RMDir /r "$un.FoundryPath\foundry-mcp-bridge"
  IfFileExists "$un.FoundryPath\foundry-mcp-bridge" foundry_removal_failed foundry_removal_success
  
  foundry_removal_failed:
  DetailPrint "Warning: Could not completely remove Foundry module files"
  Goto skip_foundry_removal
  
  foundry_removal_success:
  DetailPrint "Foundry MCP Bridge module removed successfully"
  Goto skip_foundry_removal
  
  foundry_not_found:
  DetailPrint "Foundry module installation not detected"
  
  skip_foundry_removal:
  
  ; Ask about Claude Desktop configuration removal
  MessageBox MB_YESNO "Do you want to remove the Foundry MCP Server entry from your Claude Desktop configuration?$\r$\n$\r$\n(Recommended - this will not affect other MCP servers)" IDYES remove_claude_config IDNO skip_claude_config
  
  remove_claude_config:
  DetailPrint "Removing Claude Desktop configuration entry..."
  Call un.RemoveClaudeConfig
  Goto skip_claude_config
  
  skip_claude_config:
  
  ; Remove installation directory
  RMDir "$INSTDIR"
  Delete "$INSTDIR\Uninstall.exe"
  
  DetailPrint "Uninstallation completed successfully"
  MessageBox MB_ICONINFORMATION "Foundry MCP Server has been successfully uninstalled.$\r$\n$\r$\nIf you removed the Claude Desktop configuration, please restart Claude Desktop."
  
SectionEnd

Function un.DetectFoundryModule
  ; Try to detect Foundry module installation for removal
  StrCpy $un.FoundryPath ""
  
  ; Check primary location
  StrCpy $un.FoundryPath "$LOCALAPPDATA\FoundryVTT\Data\modules"
  IfFileExists "$un.FoundryPath\foundry-mcp-bridge\module.json" foundry_module_found
  
  ; Check secondary location
  StrCpy $un.FoundryPath "$APPDATA\FoundryVTT\Data\modules"
  IfFileExists "$un.FoundryPath\foundry-mcp-bridge\module.json" foundry_module_found
  
  ; Check environment variable
  ReadEnvStr $0 "FOUNDRY_VTT_DATA_PATH"
  StrCmp $0 "" manual_search
  StrCpy $un.FoundryPath "$0\Data\modules"
  IfFileExists "$un.FoundryPath\foundry-mcp-bridge\module.json" foundry_module_found
  
  manual_search:
  ; Ask user to locate Foundry installation
  MessageBox MB_YESNO "Foundry MCP Bridge module not found automatically.$\r$\n$\r$\nWould you like to browse for your Foundry User Data folder to remove the module?" IDYES browse_for_foundry IDNO module_not_found
  
  browse_for_foundry:
  nsDialogs::SelectFolderDialog "Select Foundry VTT User Data Folder" "$LOCALAPPDATA"
  Pop $0
  StrCmp $0 CANCEL module_not_found
  StrCpy $un.FoundryPath "$0\Data\modules"
  IfFileExists "$un.FoundryPath\foundry-mcp-bridge\module.json" foundry_module_found
  
  module_not_found:
  StrCpy $un.FoundryPath ""
  Return
  
  foundry_module_found:
  DetailPrint "Found Foundry module at: $un.FoundryPath\foundry-mcp-bridge"
FunctionEnd

Function un.GetClaudeConfigPath
  ; Find Claude Desktop configuration file
  StrCpy $un.ClaudeConfigPath "$APPDATA\Claude\claude_desktop_config.json"
  IfFileExists $un.ClaudeConfigPath config_found
  StrCpy $un.ClaudeConfigPath "$LOCALAPPDATA\Claude\claude_desktop_config.json"
  IfFileExists $un.ClaudeConfigPath config_found
  StrCpy $un.ClaudeConfigPath ""
  
  config_found:
FunctionEnd

Function un.RemoveClaudeConfig
  ; Remove Foundry MCP Server entry from Claude Desktop config
  Call un.GetClaudeConfigPath
  StrCmp $un.ClaudeConfigPath "" no_config_found
  
  ; Create backup before modification  
  StrCpy $2 "$un.ClaudeConfigPath.backup"
  CopyFiles $un.ClaudeConfigPath "$2"
  DetailPrint "Created backup at: $2"
  
  ; Create temporary PowerShell script for config removal
  FileOpen $4 "$TEMP\remove-foundry-mcp.ps1" w
  FileWrite $4 "try {$\r$\n"
  FileWrite $4 "  Write-Host 'Removing foundry-mcp from Claude Desktop config'$\r$\n"
  FileWrite $4 "  $$configPath = '$un.ClaudeConfigPath'$\r$\n"
  FileWrite $4 "  Write-Host 'Config path:' $$configPath$\r$\n"
  FileWrite $4 "  $$config = Get-Content $$configPath -Raw | ConvertFrom-Json$\r$\n"
  FileWrite $4 "  if ($$config.mcpServers -and $$config.mcpServers.'foundry-mcp') {$\r$\n"
  FileWrite $4 "    $$config.mcpServers.PSObject.Properties.Remove('foundry-mcp')$\r$\n"
  FileWrite $4 "    $$json = $$config | ConvertTo-Json -Depth 10$\r$\n"
  FileWrite $4 "    [System.IO.File]::WriteAllText($$configPath, $$json, [System.Text.UTF8Encoding]::new($$false))$\r$\n"
  FileWrite $4 "    Write-Host 'SUCCESS: foundry-mcp entry removed from Claude config'$\r$\n"
  FileWrite $4 "  } else {$\r$\n"
  FileWrite $4 "    Write-Host 'INFO: foundry-mcp entry not found in config'$\r$\n"
  FileWrite $4 "  }$\r$\n"
  FileWrite $4 "} catch {$\r$\n"
  FileWrite $4 "  Write-Host 'ERROR:' $$_.Exception.Message$\r$\n"
  FileWrite $4 "  exit 1$\r$\n"
  FileWrite $4 "}$\r$\n"
  FileClose $4
  
  ; Execute the temporary PowerShell script
  ${PowerShellExecWithOutput} 'powershell.exe -inputformat none -NoProfile -ExecutionPolicy Bypass -File "$TEMP\remove-foundry-mcp.ps1"'
  
  ; Clean up temp script
  Delete "$TEMP\remove-foundry-mcp.ps1"
  Pop $0 ; Exit code
  Pop $1 ; Output
  
  IntCmp $0 0 config_success config_failed config_failed
  
  config_success:
  DetailPrint "Claude Desktop configuration updated successfully"
  DetailPrint "PowerShell output: $1"
  Return
  
  config_failed:
  DetailPrint "Failed to update Claude Desktop configuration (exit code: $0)"
  DetailPrint "PowerShell output: $1"
  MessageBox MB_ICONEXCLAMATION "Failed to remove Foundry MCP Server from Claude Desktop configuration.$\r$\n$\r$\nYou may need to manually remove the 'foundry-mcp' entry from:$\r$\n$un.ClaudeConfigPath$\r$\n$\r$\nA backup was created at:$\r$\n$un.ClaudeConfigPath.backup"
  Return
  
  no_config_found:
  DetailPrint "Claude Desktop configuration file not found"
  MessageBox MB_ICONINFORMATION "Claude Desktop configuration file not found - no configuration changes needed."
FunctionEnd