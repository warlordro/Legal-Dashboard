#requires -Version 5.1
# scripts/dev-web-local.ps1 — server web local COMPLET, fara Docker/Caddy/oauth2-proxy.
#
# Simuleaza exact ce face oauth2-proxy in productie: porneste backend-ul in
# auth_mode=web, seed-uieste adminul si minteaza cookie-ul de sesiune prin
# POST /api/v1/auth/oauth2/sync (Authorization: Basic + X-Forwarded-Email).
# DB-ul e izolat in .dev-web-local/ — nu atinge baza desktop.
#
# Usage:
#   pwsh scripts/dev-web-local.ps1 -Email admin@firma.ro [-DisplayName "Dev Admin"] [-Port 3002] [-SkipBuild]
#
# La final scriptul afiseaza cookie-ul de sesiune si instructiunile pentru
# browser. Opreste serverul cu Ctrl+C sau Stop-Process pe PID-ul afisat.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$Email,
    [string]$DisplayName = "Dev Admin",
    [int]$Port = 3002,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Fail($msg) {
    Write-Host "FAIL: $msg" -ForegroundColor Red
    exit 1
}

# 1. Build (frontend + backend CJS). NODE_ENV=production e necesar ca backend-ul
#    sa monteze dist-frontend (vezi backend/src/index.ts).
if (-not $SkipBuild) {
    Write-Host "[dev-web] npm run build..."
    npm run build
    if ($LASTEXITCODE -ne 0) { Fail "npm run build a esuat." }
}
if (-not (Test-Path (Join-Path $root "dist-backend/index.cjs"))) {
    Fail "dist-backend/index.cjs lipseste. Ruleaza fara -SkipBuild."
}

# 2. Secrete dev persistate (git-ignored) — aceleasi la fiecare rulare, ca
#    sesiunile/cheile tenant criptate sa supravietuiasca restarturilor.
$secretsPath = Join-Path $root ".dev-web-local.secrets.json"
if (Test-Path $secretsPath) {
    $secrets = Get-Content $secretsPath -Raw | ConvertFrom-Json
} else {
    function New-Secret {
        -join ((1..48) | ForEach-Object { [char](Get-Random -InputObject ([int[]]([char]'a'..[char]'z') + [int[]]([char]'0'..[char]'9'))) })
    }
    # TENANT_KEY_ENCRYPTION_SECRET trebuie sa fie base64 strict care decodeaza la
    # exact 32 de bytes (AES-256-GCM master key) — vezi tenantKeysRepository.
    function New-TenantSecret {
        $bytes = [byte[]]::new(32)
        [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
        [Convert]::ToBase64String($bytes)
    }
    $secrets = [pscustomobject]@{ jwt = New-Secret; tenant = New-TenantSecret; proxy = New-Secret }
    $secrets | ConvertTo-Json | Set-Content $secretsPath -Encoding utf8
    Write-Host "[dev-web] secrete dev generate in .dev-web-local.secrets.json (git-ignored)"
}

# 3. Env web mode + DB izolata.
$dataDir = Join-Path $root ".dev-web-local"
New-Item -ItemType Directory -Force $dataDir | Out-Null
$env:NODE_ENV = "production"
$env:LEGAL_DASHBOARD_AUTH_MODE = "web"
$env:LEGAL_DASHBOARD_JWT_SECRET = $secrets.jwt
$env:LEGAL_DASHBOARD_JWT_ISSUER = "legal-dashboard-dev-local"
$env:LEGAL_DASHBOARD_JWT_AUDIENCE = "legal-dashboard-dev-local"
$env:TENANT_KEY_ENCRYPTION_SECRET = $secrets.tenant
$env:LEGAL_DASHBOARD_OAUTH2_PROXY_SECRET = $secrets.proxy
$env:LEGAL_DASHBOARD_DB_PATH = Join-Path $dataDir "legal-dashboard.db"
$env:LEGAL_DASHBOARD_PORT = "$Port"

# 4. Porneste backend-ul (bind loopback — nu necesita ALLOW_REMOTE).
Write-Host "[dev-web] pornesc backend-ul pe http://127.0.0.1:$Port ..."
$backend = Start-Process node -ArgumentList "dist-backend/index.cjs" -PassThru -NoNewWindow

# 5. Asteapta /health (migrations la primul boot pot dura).
$base = "http://127.0.0.1:$Port"
$healthy = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $health = Invoke-RestMethod -Uri "$base/health" -TimeoutSec 2 -Method GET
        if ($health.status -eq 'ok') { $healthy = $true; break }
    } catch { }
    if ($backend.HasExited) { Fail "backend-ul s-a oprit la boot (exit $($backend.ExitCode)). Vezi output-ul de mai sus." }
}
if (-not $healthy) { Fail "/health nu a raspuns in 30s." }
Write-Host "[dev-web] backend OK (PID $($backend.Id))"

# 6. Seed admin (idempotent cand userul e deja admin activ).
$env:SEED_ADMIN_EMAIL = $Email
$env:SEED_ADMIN_DISPLAY_NAME = $DisplayName
node scripts/seed-admin.mjs
if ($LASTEXITCODE -ne 0) { Fail "seed-admin a esuat (vezi mesajul de mai sus)." }

# 7. Porneste mini-proxy-ul care simuleaza oauth2-proxy (injecteaza Basic +
#    X-Forwarded-Email pe fiecare request). SPA-ul isi minteaza sesiunea singur
#    la bootstrap prin POST /auth/oauth2/sync — fara proxy, bridge-ul refuza
#    403 si aplicatia arata "Acces refuzat" (login-ul NU merge doar cu cookie).
$proxyPort = $Port + 1
$env:DEV_WEB_PROXY_SECRET = $secrets.proxy
$env:DEV_WEB_PROXY_EMAIL = $Email
$proxy = Start-Process node -ArgumentList "scripts/dev-web-proxy.mjs", "$proxyPort", "$Port" -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $dataDir "proxy.log") -RedirectStandardError (Join-Path $dataDir "proxy.err.log")
Start-Sleep -Seconds 1

# 8. Verifica bridge-ul prin proxy (fara header-e client — exact ca browserul).
try {
    $sync = Invoke-WebRequest -Uri "http://127.0.0.1:$proxyPort/api/v1/auth/oauth2/sync" -Method POST -UseBasicParsing
    if ($sync.StatusCode -ne 200) { Fail "bridge-ul prin proxy a raspuns $($sync.StatusCode)." }
} catch {
    Fail "bridge-ul prin proxy a esuat: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "=== Web local gata ===" -ForegroundColor Green
Write-Host "Deschide:  http://127.0.0.1:$proxyPort   (login automat ca $Email, admin)"
Write-Host "Backend:   $base (PID $($backend.Id))  |  Proxy: PID $($proxy.Id)"
Write-Host ""
Write-Host "Stop: Stop-Process -Id $($backend.Id), $($proxy.Id)"
