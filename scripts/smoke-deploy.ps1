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

function Get-Status($url, $headers) {
    # Works on both PS 5.1 (WebException) and PS 7 (HttpResponseException):
    # both exception types expose .Response with a .StatusCode, so a single
    # generic catch reads the status uniformly. -MaximumRedirection 0 keeps a
    # 302 observable instead of silently following the OAuth redirect chain.
    $args = @{ Uri = $url; TimeoutSec = $TimeoutSec; Method = 'GET'; UseBasicParsing = $true; MaximumRedirection = 0 }
    if ($headers) { $args.Headers = $headers }
    try {
        $resp = Invoke-WebRequest @args
        return [int]$resp.StatusCode
    } catch {
        $response = $_.Exception.Response
        if ($null -ne $response) {
            return [int]$response.StatusCode
        }
        Fail "$url request failed: $($_.Exception.Message)"
    }
}

# 2. /api/v1/me — accept 200 (desktop), 401 (web auth gate, direct backend) or
#    302 (public HTTPS edge: oauth2-proxy redirects sessionless requests to Google)
$meStatus = Get-Status "$BaseUrl/api/v1/me"
switch ($meStatus) {
    200 { Write-Host "[smoke] /api/v1/me 200 - assumed desktop / single-tenant mode" }
    401 { Write-Host "[smoke] /api/v1/me 401 - web mode auth gate active (expected behind reverse proxy)" }
    302 { Write-Host "[smoke] /api/v1/me 302 - OAuth gate active (expected on the public HTTPS edge)" }
    default { Fail "/api/v1/me returned unexpected status $meStatus (expected 200 desktop, 401 web, 302 edge)" }
}

# 3. PAT ingress (v2.40.1) — only against the PUBLIC HTTPS edge (Caddy @pat
#    route). Invalid PAT => 401 JSON from backend; 302 = fell into oauth2-proxy
#    flow, ingress route missing. Skipped for direct-backend targets.
function Get-HeaderValue($headers, [string]$name) {
    # Normalizes across PS 5.1 (WebHeaderCollection: .Get) and PS 7
    # (HttpResponseHeaders: .TryGetValues) and plain dictionaries.
    if ($null -eq $headers) { return $null }
    if ($headers -is [System.Collections.IDictionary]) { return $headers[$name] }
    if ($headers -is [System.Net.WebHeaderCollection]) { return $headers.Get($name) }
    $values = $null
    if ($headers.TryGetValues($name, [ref]$values)) { return ($values | Select-Object -First 1) }
    return $null
}

if ($BaseUrl -like 'https://*') {
    $patStatus = $null
    $patHeaders = $null
    try {
        # -MaximumRedirection 0 keeps the 302 observable. On non-2xx both PS 5.1
        # (WebException) and PS 7 (HttpResponseException) throw; both expose
        # .Response with .StatusCode/.Headers, read in the generic catch below.
        $resp = Invoke-WebRequest -Uri "$BaseUrl/api/dosare?numarDosar=smoke" `
            -TimeoutSec $TimeoutSec -Method GET -UseBasicParsing -MaximumRedirection 0 `
            -Headers @{ Authorization = 'Bearer ld_pat_smoke_invalid' }
        $patStatus = [int]$resp.StatusCode
        $patHeaders = $resp.Headers
    } catch {
        $response = $_.Exception.Response
        if ($null -ne $response) {
            $patStatus = [int]$response.StatusCode
            $patHeaders = $response.Headers
        } else {
            Fail "PAT ingress request failed: $($_.Exception.Message)"
        }
    }
    switch ($patStatus) {
        401 { Write-Host "[smoke] PAT ingress 401 - direct backend route active (expected)" }
        302 { Fail "PAT ingress returned 302 (OAuth redirect) - Caddy @pat route missing; PAT clients cannot reach the backend" }
        default { Fail "PAT ingress returned unexpected status $patStatus (expected 401)" }
    }
    # Site-level security headers must apply to the PAT handle too.
    if (-not (Get-HeaderValue $patHeaders 'Strict-Transport-Security')) { Fail "PAT ingress response missing Strict-Transport-Security header" }
    if (-not (Get-HeaderValue $patHeaders 'X-Content-Type-Options')) { Fail "PAT ingress response missing X-Content-Type-Options header" }
    Write-Host "[smoke] PAT ingress security headers present"
} else {
    Write-Host "[smoke] PAT ingress probe skipped (BASE_URL is not the public HTTPS edge)"
}

# 4. / static frontend — accept 200 prod, 404 dev, or 302 public edge (OAuth gate)
$indexStatus = Get-Status "$BaseUrl/"
if ($indexStatus -ne 200 -and $indexStatus -ne 404 -and $indexStatus -ne 302) {
    Fail "/ returned unexpected status $indexStatus"
}
Write-Host "[smoke] / static frontend status $indexStatus (200 prod / 404 dev / 302 edge - all OK)"

Write-Host "[smoke] PASS" -ForegroundColor Green
