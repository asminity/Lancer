<#
.SYNOPSIS
    Starts the AUTONEX 3D Virtual Office Frontend.
#>
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$FrontendDir = Join-Path $RootDir "frontend"

Set-Location $FrontendDir

if (-not (Test-Path "node_modules")) {
    Write-Host "[AUTONEX] Installing frontend dependencies..." -ForegroundColor Cyan
    npm install
}

Write-Host "[AUTONEX] Launching AUTONEX 3D Office Frontend on http://localhost:5173..." -ForegroundColor Green
npm run dev
