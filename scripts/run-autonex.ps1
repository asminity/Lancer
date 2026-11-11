<#
.SYNOPSIS
    Convenience wrapper to launch AUTONEX (PAG) backend from AUTONEX root.
.EXAMPLE
    .\scripts\run-autonex.ps1 D:\myproject assist
    .\scripts\run-autonex.ps1 D:\myproject turbo
    .\scripts\run-autonex.ps1 --list-models
#>
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$PagScript = Join-Path $RootDir "backend\bin\pag.ps1"

& $PagScript @args

