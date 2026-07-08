# ==============================================================================
# S.A.F. - Secuencia de Inicio de la Plataforma (Windows PowerShell)
# ==============================================================================

$root = $PSScriptRoot
if (-not $root) { $root = Get-Location }

Write-Host ""
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "        S.A.F. - INICIANDO STACK COMPLETO (4 SERVICIOS)             " -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Target Server (Port 3001)
Write-Host "[1/4] Levantando Target Server (Puerto 3001)..." -ForegroundColor Yellow
$targetCmd = '$Host.UI.RawUI.WindowTitle = ''[S.A.F. 1/4] Target Server (Port 3001)''; cd ''' + $root + '\target-server''; Write-Host ''=== TARGET SERVER ==='' -ForegroundColor Green; npm start'
Start-Process powershell -ArgumentList "-NoExit", "-Command", $targetCmd
Start-Sleep -Seconds 2

# 2. Telemetry Agent
Write-Host "[2/4] Levantando Telemetry Agent..." -ForegroundColor Yellow
$agentCmd = '$Host.UI.RawUI.WindowTitle = ''[S.A.F. 2/4] Telemetry Agent''; cd ''' + $root + '\telemetry-agent''; Write-Host ''=== TELEMETRY AGENT ==='' -ForegroundColor Green; .\agent.exe'
Start-Process powershell -ArgumentList "-NoExit", "-Command", $agentCmd
Start-Sleep -Seconds 2

# 3. Predictive Engine (Port 8000)
Write-Host "[3/4] Levantando Predictive Engine (Puerto 8000)..." -ForegroundColor Yellow
$engineCmd = '$Host.UI.RawUI.WindowTitle = ''[S.A.F. 3/4] Predictive Engine (Port 8000)''; cd ''' + $root + '\predictive-engine''; Write-Host ''=== PREDICTIVE ENGINE ==='' -ForegroundColor Green; if (Test-Path ''.venv\Scripts\Activate.ps1'') { try { . ''.venv\Scripts\Activate.ps1'' } catch {} }; & ''.venv\Scripts\python.exe'' -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload'
Start-Process powershell -ArgumentList "-NoExit", "-Command", $engineCmd
Start-Sleep -Seconds 2

# 4. NOC Dashboard (Port 3005)
Write-Host "[4/4] Levantando NOC Dashboard (Puerto 3005)..." -ForegroundColor Yellow
$dashCmd = '$Host.UI.RawUI.WindowTitle = ''[S.A.F. 4/4] NOC Dashboard (Port 3005)''; cd ''' + $root + '\noc-dashboard''; Write-Host ''=== NOC DASHBOARD ==='' -ForegroundColor Green; npm run dev'
Start-Process powershell -ArgumentList "-NoExit", "-Command", $dashCmd

Write-Host ""
Write-Host "====================================================================" -ForegroundColor Green
Write-Host "  [OK] Todos los servicios han sido lanzados en ventanas separadas! " -ForegroundColor Green
Write-Host "====================================================================" -ForegroundColor Green
Write-Host "  > Target Server:     http://localhost:3001" -ForegroundColor White
Write-Host "  > Predictive Engine: http://localhost:8000" -ForegroundColor White
Write-Host "  > NOC Dashboard:     http://localhost:3005" -ForegroundColor White
Write-Host ""
Write-Host "Para iniciar la prueba de carga o ataque de caos, ejecuta en tu terminal:" -ForegroundColor Cyan
Write-Host "  cd load-tester; k6 run main.js" -ForegroundColor Yellow
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""
