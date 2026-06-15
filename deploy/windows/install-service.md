# Run the standalone bridge as a Windows service (scaffold)

> **Scaffold — not executed by this repo.** These are the steps to keep the
> standalone bridge running unattended (survives logout / reboot) on the Windows
> box. Pick **one** of the two options. Fill in the absolute paths for your machine.
>
> Phase 6 target: the bridge eventually moves to an always-on host (Pi/VPS, see
> [docs/REMOTE-ACCESS.md](../../docs/REMOTE-ACCESS.md)); until then this keeps it up
> on your PC. The control channel stays bound to **loopback** — remote reach is
> provided by the Cloudflare Tunnel in front of the **dashboard**, never by
> exposing 31414 directly.

## Prerequisites

- A production build: `npm run build:server` (or install the packaged build).
- Decide the bind: keep `MCP_CONTROL_HOST=127.0.0.1` (recommended). Do **not** bind
  the control channel to a public interface — front it with the tunnel instead.

## Option A — NSSM (the Non-Sucking Service Manager)

`nssm` wraps any console app as a service with restart-on-crash. Download it from
nssm.cc (not installed here).

```bat
REM From an elevated prompt. Replace <REPO> with the absolute repo path.
nssm install FoundryMcpBridge "C:\Program Files\nodejs\node.exe" "<REPO>\packages\mcp-server\dist\standalone.js"
nssm set   FoundryMcpBridge AppDirectory "<REPO>"
nssm set   FoundryMcpBridge AppEnvironmentExtra MCP_CONTROL_HOST=127.0.0.1 MCP_CONTROL_PORT=31414
nssm set   FoundryMcpBridge Start SERVICE_AUTO_START
nssm start FoundryMcpBridge
```

Manage: `nssm restart FoundryMcpBridge`, `nssm stop FoundryMcpBridge`,
`nssm remove FoundryMcpBridge confirm`. Logs: `nssm set FoundryMcpBridge AppStdout`/`AppStderr`
to a file path.

## Option B — Task Scheduler (no extra tooling)

Run at logon / startup, restart on failure:

```powershell
# Elevated PowerShell. Replace <REPO>.
$action  = New-ScheduledTaskAction -Execute "C:\Program Files\nodejs\node.exe" `
             -Argument "<REPO>\packages\mcp-server\dist\standalone.js" -WorkingDirectory "<REPO>"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "FoundryMcpBridge" -Action $action -Trigger $trigger -Settings $settings
```

## Verify it's up

```bat
REM Should print the tool catalog over the control channel.
node "<REPO>\scripts\standalone-smoke-test.mjs"
```

(That smoke test uses a throwaway port; to check the _real_ service, point the co-GM
dashboard at `127.0.0.1:31414` — `npm run dev:cogm` — and confirm the feed connects.)

## ⚠️ Single-instance note

The backend takes a port-scoped singleton lock. Do **not** run this service on
`31414` at the same time as a Claude-Desktop-spawned backend — they'd both want the
same control channel. Either close Claude Desktop's MCP server, or run the service on
an alternate `MCP_CONTROL_PORT` and point the dashboard there.
