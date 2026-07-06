# scripts/dev-web-local.ps1 — porneste mediul local de testare pentru web mode:
# backend in mod web (DB izolata, git-ignored) + doua proxy-uri care simuleaza
# oauth2-proxy (admin si user normal).
#
# Folosire (din radacina repo-ului sau de oriunde):
#   powershell -File scripts/dev-web-local.ps1
#   powershell -File scripts/dev-web-local.ps1 -SkipBuild        # fara rebuild
#
# Dupa pornire:
#   admin:       http://127.0.0.1:3003   (identitate: -AdminEmail)
#   user normal: http://localhost:3004   (identitate: -UserEmail)
# ATENTIE (capcana cookie): cookie-urile browserului sunt scope-uite pe HOST,
# nu pe port. Doua tab-uri pe 127.0.0.1 si-ar fura reciproc sesiunea — de aceea
# adminul se deschide pe 127.0.0.1 si userul pe localhost (cookie jar diferit).
# NU e bug de aplicatie.
#
# Userul normal primeste 403 not_provisioned pana cand adminul il creeaza
# (pana la MR-ul de users management: INSERT manual in tabela users).
#
# Secretele sunt persistente in .dev-web-local.secrets.json (git-ignored),
# generate EXCLUSIV din RNG criptografic. DB-ul traieste in .dev-web-local/
# (git-ignored). Reset complet: opreste procesele, sterge .dev-web-local/ si
# .dev-web-local.secrets.json, ruleaza scriptul din nou.

param(
  [string]$AdminEmail = "admin@local.test",
  [string]$AdminDisplayName = "Admin Local",
  [string]$UserEmail = "user@local.test",
  [int]$BackendPort = 3002,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $root ".dev-web-local"
$secretsPath = Join-Path $root ".dev-web-local.secrets.json"
$adminProxyPort = $BackendPort + 1
$userProxyPort = $BackendPort + 2

# PID-urile proceselor pornite de acest script; Fail() le opreste pe toate.
$script:startedPids = @()

function Stop-Started {
  foreach ($procId in $script:startedPids) {
    try {
      Stop-Process -Id $procId -Force -ErrorAction Stop
      Write-Host "[dev-web-local] proces oprit: PID $procId"
    } catch {
      # Un esec de oprire NU e silentios: userul trebuie sa stie ce a ramas orfan.
      Write-Warning "[dev-web-local] NU am putut opri PID $procId ($($_.Exception.Message)). Opreste-l manual: Stop-Process -Id $procId -Force"
    }
  }
}

function Fail([string]$message) {
  Write-Error -ErrorAction Continue "[dev-web-local] $message"
  Stop-Started
  exit 1
}

function New-RandomBase64([int]$byteCount) {
  $bytes = [byte[]]::new($byteCount)
  # RNG criptografic — NU Get-Random (predictibil, nepotrivit pentru secrete).
  # Create()/GetBytes() in loc de ::Fill(): Fill exista doar in .NET Core 3+,
  # iar `powershell.exe` (Windows PowerShell 5.1, .NET Framework) crapa pe el
  # cu "does not contain a method named 'Fill'" — exact la primul run.
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes)
}

function Test-PortFree([int]$port) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  return ($null -eq $conn)
}

# --- 0. Pre-checks -----------------------------------------------------------
foreach ($port in @($BackendPort, $adminProxyPort, $userProxyPort)) {
  if (-not (Test-PortFree $port)) {
    $owner = (Get-NetTCPConnection -LocalPort $port -State Listen | Select-Object -First 1).OwningProcess
    Fail "Portul $port e deja ocupat (PID $owner). Opreste procesul sau alege alt -BackendPort."
  }
}

# --- 1. Build (NODE_ENV=production ca backend-ul sa serveasca dist-frontend) --
Set-Location $root
if (-not $SkipBuild) {
  Write-Host "[dev-web-local] npm run build..."
  $env:NODE_ENV = "production"
  npm run build | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail "npm run build a esuat (exit $LASTEXITCODE)." }
}
if (-not (Test-Path (Join-Path $root "dist-backend\index.cjs"))) {
  Fail "dist-backend\index.cjs lipseste. Ruleaza fara -SkipBuild."
}

# --- 2. Secrete persistente (git-ignored) ------------------------------------
if (Test-Path $secretsPath) {
  # Fisier corupt/legacy -> mesaj ghidat, nu stack trace brut ($ErrorActionPreference=Stop).
  try {
    $secrets = Get-Content $secretsPath -Raw | ConvertFrom-Json
    $tenantBytes = [Convert]::FromBase64String([string]$secrets.tenantKeySecret)
  } catch {
    Fail "Nu pot citi secretele din $secretsPath ($($_.Exception.Message)). Pentru reset: sterge $secretsPath SI $stateDir, apoi ruleaza din nou."
  }
  if ($tenantBytes.Length -ne 32) {
    # NU regeneram silentios: cheia tenant cripteaza chei deja salvate in DB-ul
    # local; o cheie noua le-ar face ilizibile fara niciun mesaj.
    Fail "tenantKeySecret din $secretsPath nu decodeaza la exact 32 bytes. Pentru reset: sterge $secretsPath SI $stateDir, apoi ruleaza din nou."
  }
} else {
  $secrets = [pscustomobject]@{
    jwtSecret = New-RandomBase64 48
    proxySecret = New-RandomBase64 48
    tenantKeySecret = New-RandomBase64 32   # base64 strict de EXACT 32 bytes
  }
  $secrets | ConvertTo-Json | Set-Content $secretsPath -Encoding utf8
  Write-Host "[dev-web-local] secrete noi generate in $secretsPath"
}

# --- 3. Env pentru backend ----------------------------------------------------
New-Item -ItemType Directory -Force $stateDir | Out-Null
$env:LEGAL_DASHBOARD_AUTH_MODE = "web"
$env:LEGAL_DASHBOARD_JWT_SECRET = $secrets.jwtSecret
$env:LEGAL_DASHBOARD_JWT_ISSUER = "legal-dashboard-dev-local"
$env:LEGAL_DASHBOARD_JWT_AUDIENCE = "legal-dashboard-dev-local"
$env:LEGAL_DASHBOARD_OAUTH2_PROXY_SECRET = $secrets.proxySecret
$env:TENANT_KEY_ENCRYPTION_SECRET = $secrets.tenantKeySecret
$env:LEGAL_DASHBOARD_DB_PATH = Join-Path $stateDir "legal-dashboard.db"
$env:NODE_ENV = "production"
$env:PORT = "$BackendPort"

# --- 4. Backend ----------------------------------------------------------------
Write-Host "[dev-web-local] pornesc backend-ul pe portul $BackendPort..."
$backendProc = Start-Process node -ArgumentList "dist-backend/index.cjs" -WorkingDirectory $root -NoNewWindow -PassThru `
  -RedirectStandardOutput (Join-Path $stateDir "backend.out.log") `
  -RedirectStandardError (Join-Path $stateDir "backend.err.log")
$script:startedPids += $backendProc.Id

$healthy = $false
for ($i = 0; $i -lt 40; $i++) {
  if ($backendProc.HasExited) { break }
  try {
    Invoke-RestMethod "http://127.0.0.1:$BackendPort/health" -TimeoutSec 2 | Out-Null
    $healthy = $true
    break
  } catch {
    Start-Sleep -Milliseconds 500
  }
}
if (-not $healthy) {
  Get-Content (Join-Path $stateDir "backend.err.log") -Tail 20 -ErrorAction SilentlyContinue | Out-Host
  Fail "Backend-ul nu a raspuns la /health in 20s (vezi $stateDir\backend.err.log)."
}
Write-Host "[dev-web-local] backend OK (PID $($backendProc.Id))."

# --- 5. Seed admin --------------------------------------------------------------
$env:SEED_ADMIN_EMAIL = $AdminEmail
$env:SEED_ADMIN_DISPLAY_NAME = $AdminDisplayName
node (Join-Path $root "scripts\seed-admin.mjs") | Out-Host
if ($LASTEXITCODE -ne 0) {
  Fail "seed-admin.mjs a esuat (exit $LASTEXITCODE; 2 = emailul exista cu alt rol — rezolva manual)."
}

# --- 6. Proxy-urile oauth2 simulate ---------------------------------------------
$env:DEV_WEB_PROXY_SECRET = $secrets.proxySecret
$env:DEV_WEB_PROXY_UPSTREAM_PORT = "$BackendPort"

$env:DEV_WEB_PROXY_PORT = "$adminProxyPort"
$env:DEV_WEB_PROXY_EMAIL = $AdminEmail
$adminProxyProc = Start-Process node -ArgumentList "scripts/dev-web-proxy.mjs" -WorkingDirectory $root -NoNewWindow -PassThru `
  -RedirectStandardOutput (Join-Path $stateDir "proxy-admin.out.log") `
  -RedirectStandardError (Join-Path $stateDir "proxy-admin.err.log")
$script:startedPids += $adminProxyProc.Id

$env:DEV_WEB_PROXY_PORT = "$userProxyPort"
$env:DEV_WEB_PROXY_EMAIL = $UserEmail
$userProxyProc = Start-Process node -ArgumentList "scripts/dev-web-proxy.mjs" -WorkingDirectory $root -NoNewWindow -PassThru `
  -RedirectStandardOutput (Join-Path $stateDir "proxy-user.out.log") `
  -RedirectStandardError (Join-Path $stateDir "proxy-user.err.log")
$script:startedPids += $userProxyProc.Id

Start-Sleep -Milliseconds 800
foreach ($pair in @(@($adminProxyProc, "proxy-admin"), @($userProxyProc, "proxy-user"))) {
  if ($pair[0].HasExited) {
    Get-Content (Join-Path $stateDir "$($pair[1]).err.log") -Tail 10 -ErrorAction SilentlyContinue | Out-Host
    Fail "$($pair[1]) a murit imediat dupa pornire (vezi logurile din $stateDir)."
  }
}

# --- 7. Verificarea bridge-ului prin proxy ---------------------------------------
try {
  $sync = Invoke-WebRequest "http://127.0.0.1:$adminProxyPort/api/v1/auth/oauth2/sync" -Method POST -UseBasicParsing
} catch {
  Fail "Bridge-ul prin proxy-ul admin a esuat: $($_.Exception.Message)"
}
if ($sync.StatusCode -ne 200) { Fail "Bridge-ul prin proxy a raspuns $($sync.StatusCode), asteptat 200." }
if (-not ("$($sync.Headers["Set-Cookie"])" -match "legal_dashboard_session=")) {
  Fail "Bridge-ul a raspuns 200 dar fara cookie-ul de sesiune."
}
Write-Host "[dev-web-local] bridge verificat prin proxy: 200 + cookie de sesiune."

# --- Sumar -----------------------------------------------------------------------
Write-Host ""
Write-Host "=== Mediu web local pornit ==="
Write-Host "  Admin ($AdminEmail):  http://127.0.0.1:$adminProxyPort"
Write-Host "  User  ($UserEmail):   http://localhost:$userProxyPort   <- localhost, NU 127.0.0.1 (cookie jar separat)"
Write-Host "  Backend direct:       http://127.0.0.1:$BackendPort (PID $($backendProc.Id))"
Write-Host "  Loguri:               $stateDir\*.log"
Write-Host "  PID-uri:              backend=$($backendProc.Id) proxy-admin=$($adminProxyProc.Id) proxy-user=$($userProxyProc.Id)"
Write-Host "  Oprire:               Stop-Process -Id $($backendProc.Id),$($adminProxyProc.Id),$($userProxyProc.Id) -Force"
Write-Host ""
Write-Host "Userul normal primeste 403 not_provisioned pana e creat de admin."
