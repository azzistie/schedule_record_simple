param([int]$Port = 8765, [switch]$LocalOnly, [switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$pythonCandidates = @(
  (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe')
)
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCmd) { $pythonCandidates += $pythonCmd.Source }
$pythonExe = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $pythonExe) {
  Write-Host 'Python 3.10+ is required. You can also open dist/index.html for browser-only use.'
  exit 1
}
$serverArgs = @((Join-Path $taskRoot 'server.py'), '--port', "$Port")
if (-not $LocalOnly) { $serverArgs += '--lan' }
if (-not $NoOpen) { $serverArgs += '--open' }
& $pythonExe @serverArgs
exit $LASTEXITCODE
