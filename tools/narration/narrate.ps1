#requires -Version 7
<#
.SYNOPSIS
  Run the narration tool with the Python environment that has the voices.

.DESCRIPTION
  Reads %APPDATA%\foundry-ai-tool\narration.env (KEY=value lines) for:
    NARRATION_PYTHON   python.exe of the voice environment (chatterbox-tts on a CUDA PyTorch)
    HF_HOME            Hugging Face cache that holds (or will hold) the voice models
    NARRATION_OUT_DIR  optional, default Documents\FoundryNarration
  Everything after the script name goes to the tool, for example:
    pwsh tools/narration/narrate.ps1 make tools/narration/examples/welcome.da.md
    pwsh tools/narration/narrate.ps1 list my-video.en.md
    pwsh tools/narration/narrate.ps1 retake my-video.en.md 4 7
#>
$ErrorActionPreference = 'Stop'
$envFile = Join-Path $env:APPDATA 'foundry-ai-tool/narration.env'
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$' -and -not $line.TrimStart().StartsWith('#')) {
      Set-Item -Path "env:$($Matches[1])" -Value $Matches[2]
    }
  }
}
$python = $env:NARRATION_PYTHON
if (-not $python -or -not (Test-Path $python)) {
  throw "Set NARRATION_PYTHON in $envFile to the python.exe of the voice environment (see tools/narration/README.md)."
}
$env:PYTHONPATH = Join-Path $PSScriptRoot 'src'
$env:PYTHONUTF8 = '1'
$env:HF_HUB_DISABLE_TELEMETRY = '1'
$env:TQDM_DISABLE = '1'          # no per-sentence progress bars from the voice models
$env:PYTHONWARNINGS = 'ignore'   # the models' library deprecation warnings
& $python -m narration @args
exit $LASTEXITCODE
