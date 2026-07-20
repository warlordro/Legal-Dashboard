#requires -Version 5.1
# Host-side smoke check for a running Legal Dashboard backend on Windows hosts.
# Mirrors scripts/smoke-deploy.sh — exits 0 on success, non-zero on the first
# failed probe.
#
# Usage:
#   pwsh scripts/smoke-deploy.ps1
#   $env:BASE_URL = "http://app.local:3002"; pwsh scripts/smoke-deploy.ps1

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$BaseUrl = if ($env:BASE_URL) { $env:BASE_URL } else { 'http://127.0.0.1:3002' }
$TimeoutSec = if ($env:TIMEOUT) { [int]$env:TIMEOUT } else { 5 }

function Fail($msg) {
    Write-Host "FAIL: $msg" -ForegroundColor Red
    exit 1
}

Write-Host "[smoke] target: $BaseUrl"

# 1. /health
try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/health" -TimeoutSec $TimeoutSec -Method GET
} catch {
    Fail "/health did not respond within ${TimeoutSec}s: $($_.Exception.Message)"
}
$healthJson = $health | ConvertTo-Json -Compress
Write-Host "[smoke] /health body: $healthJson"
if ($health.status -ne 'ok') {
    Fail "/health body missing status=ok (got: $healthJson)"
}

function Get-Status($url) {
    # Compatible with PS 5.1 (no -SkipHttpErrorCheck): throws on non-2xx, so we
    # read the status from the WebException and return it explicitly.
    try {
        $resp = Invoke-WebRequest -Uri $url -TimeoutSec $TimeoutSec -Method GET -UseBasicParsing
        return [int]$resp.StatusCode
    } catch [System.Net.WebException] {
        if ($_.Exception.Response -ne $null) {
            return [int]$_.Exception.Response.StatusCode
        }
        Fail "$url request failed: $($_.Exception.Message)"
    } catch {
        Fail "$url request failed: $($_.Exception.Message)"
    }
}

# 2. /api/v1/me — accept 200 (desktop) or 401 (web mode auth gate)
$meStatus = Get-Status "$BaseUrl/api/v1/me"
switch ($meStatus) {
    200 { Write-Host "[smoke] /api/v1/me 200 - assumed desktop / single-tenant mode" }
    401 { Write-Host "[smoke] /api/v1/me 401 - web mode auth gate active (expected behind reverse proxy)" }
    default { Fail "/api/v1/me returned unexpected status $meStatus (expected 200 desktop or 401 web)" }
}

# 3. / static frontend — accept 200 prod or 404 dev
$indexStatus = Get-Status "$BaseUrl/"
if ($indexStatus -ne 200 -and $indexStatus -ne 404) {
    Fail "/ returned unexpected status $indexStatus"
}
Write-Host "[smoke] / static frontend status $indexStatus (200 prod / 404 dev - both OK)"

Write-Host "[smoke] PASS" -ForegroundColor Green
