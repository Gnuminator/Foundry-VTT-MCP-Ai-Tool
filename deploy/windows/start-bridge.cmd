@echo off
REM ============================================================================
REM  foundry-mcp-bridge - standalone backend launcher (Windows)
REM ----------------------------------------------------------------------------
REM  Double-click (or run from a terminal) to start the MCP bridge as a
REM  long-lived process WITHOUT Claude Desktop. The co-GM dashboard connects to
REM  its control channel exactly as it does to the Claude-Desktop-spawned backend.
REM
REM  This is a SCAFFOLD for the dev/workspace layout (runs the compiled dist/).
REM  For an installed build, point NODE_SCRIPT at the installed standalone.js (or
REM  the bundled backend) instead. To run it unattended as a Windows service, see
REM  install-service.md in this folder.
REM
REM  Optional overrides (set before running, or edit here):
REM    set MCP_CONTROL_HOST=127.0.0.1   REM bind host (keep loopback unless tunneling)
REM    set MCP_CONTROL_PORT=31414       REM control-channel port
REM ============================================================================

setlocal
REM Resolve repo root = three levels up from this script (deploy\windows\..\..).
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%..\.." || goto :error
set "REPO_ROOT=%CD%"

set "NODE_SCRIPT=%REPO_ROOT%\packages\mcp-server\dist\standalone.js"
if not exist "%NODE_SCRIPT%" (
  echo [start-bridge] Build artifacts not found at:
  echo     %NODE_SCRIPT%
  echo [start-bridge] Run "npm run build:server" first, then re-run this script.
  goto :error
)

echo [start-bridge] Starting foundry-mcp-bridge standalone backend...
echo [start-bridge]   control channel: %MCP_CONTROL_HOST% (default 127.0.0.1) : %MCP_CONTROL_PORT% (default 31414)
echo [start-bridge]   (Ctrl+C to stop)
node "%NODE_SCRIPT%" %*

popd
endlocal
goto :eof

:error
echo [start-bridge] Failed to launch. See messages above.
popd 2>nul
endlocal
exit /b 1
