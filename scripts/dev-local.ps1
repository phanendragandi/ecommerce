# QuickCart — local dev bootstrap (Windows PowerShell 5.1 compatible)
#
# Prereq: Docker Desktop installed and RUNNING (whale icon steady in tray).
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File scripts\dev-local.ps1           # start everything
#   powershell -ExecutionPolicy Bypass -File scripts\dev-local.ps1 -Reset    # also wipe DB + re-apply migrations/seed
#
# What it does:
#   1. Starts the local Supabase stack (Postgres + Auth + Storage) via Docker.
#      First start applies /supabase/migrations and seed.sql automatically.
#   2. Writes .env (frontend) and server\.env (API) with the local keys.
#   3. Opens two windows: Express API (:4000) and Next.js (:3000).
#
# Demo seller login (created by supabase/seed.sql, LOCAL ONLY):
#   email:    demo-seller@quickcart.test
#   password: Qc-Demo-Local-Only-9f3b7c1e5a284d06b1e7f4c2a9d80351

param([switch]$Reset)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# --- 1. Docker must be up -----------------------------------------------------
docker info *> $null
if (-not $?) {
  Write-Host 'Docker is not running. Start Docker Desktop and re-run this script.' -ForegroundColor Red
  exit 1
}

# --- 2. Supabase local stack --------------------------------------------------
Write-Host 'Starting local Supabase (first run downloads images, can take a few minutes)...' -ForegroundColor Cyan
npx supabase start
if (-not $?) { Write-Host 'supabase start failed.' -ForegroundColor Red; exit 1 }

if ($Reset) {
  Write-Host 'Resetting DB: re-applying migrations + seed...' -ForegroundColor Cyan
  npx supabase db reset
  if (-not $?) { Write-Host 'supabase db reset failed.' -ForegroundColor Red; exit 1 }
}

# --- 3. Pull keys from the running stack and write env files -------------------
$status = npx supabase status -o env | Out-String
function Get-EnvVal([string]$name, [string]$blob) {
  if ($blob -match "(?m)^$name=`"?([^`"\r\n]+)`"?") { return $Matches[1] }
  throw "Could not find $name in 'supabase status' output."
}
$apiUrl     = Get-EnvVal 'API_URL' $status
$anonKey    = Get-EnvVal 'ANON_KEY' $status
$serviceKey = Get-EnvVal 'SERVICE_ROLE_KEY' $status

@"
NEXT_PUBLIC_CURRENCY=`$

# Local Supabase (docker) — written by scripts/dev-local.ps1
NEXT_PUBLIC_SUPABASE_URL=$apiUrl
NEXT_PUBLIC_SUPABASE_ANON_KEY=$anonKey

# Express API base URL
NEXT_PUBLIC_API_URL=http://localhost:4000

# Razorpay publishable key id (test mode) — fill in to test checkout
NEXT_PUBLIC_RAZORPAY_KEY_ID=
"@ | Out-File -FilePath (Join-Path $repo '.env') -Encoding utf8

@"
PORT=4000
NODE_ENV=development

# Local Supabase (docker) — written by scripts/dev-local.ps1
SUPABASE_URL=$apiUrl
SUPABASE_SERVICE_ROLE_KEY=$serviceKey

# Razorpay test keys — fill in to test checkout/payments
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

CORS_ORIGIN=http://localhost:3000
"@ | Out-File -FilePath (Join-Path $repo 'server\.env') -Encoding utf8

Write-Host 'Env files written: .env and server\.env' -ForegroundColor Green

# --- 4. Launch API + frontend in their own windows -----------------------------
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$repo\server'; npm run dev"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$repo'; npm run dev"

Write-Host ''
Write-Host 'QuickCart local stack:' -ForegroundColor Green
Write-Host '  Store    : http://localhost:3000'
Write-Host '  Seller   : http://localhost:3000/seller  (log in first)'
Write-Host '  API      : http://localhost:4000/health'
Write-Host "  Supabase : $apiUrl (Studio: http://127.0.0.1:54323)"
Write-Host ''
Write-Host 'Demo seller login:' -ForegroundColor Yellow
Write-Host '  email    : demo-seller@quickcart.test'
Write-Host '  password : Qc-Demo-Local-Only-9f3b7c1e5a284d06b1e7f4c2a9d80351'
