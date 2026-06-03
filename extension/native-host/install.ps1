# Vault Local — Registrar Native Messaging Host para Chrome, Edge y Firefox.
# Ejecutar con: powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  Vault Local - Native Messaging Host" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Obtener ruta absoluta al manifiesto
$chromeManifest = Join-Path $PSScriptRoot "com.vaultlocal.app.json"
$firefoxManifest = Join-Path $PSScriptRoot "com.vaultlocal.app.firefox.json"

# Verificar que los archivos existen
if (-not (Test-Path $chromeManifest)) {
    Write-Host "[ERROR] No se encontro: $chromeManifest" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $firefoxManifest)) {
    Write-Host "[ERROR] No se encontro: $firefoxManifest" -ForegroundColor Red
    exit 1
}

# Registrar para Google Chrome
$chromePath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.vaultlocal.app"
New-Item -Path $chromePath -Force | Out-Null
Set-ItemProperty -Path $chromePath -Name "(Default)" -Value $chromeManifest
Write-Host "[OK] Chrome: $chromePath" -ForegroundColor Green

# Registrar para Microsoft Edge
$edgePath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.vaultlocal.app"
New-Item -Path $edgePath -Force | Out-Null
Set-ItemProperty -Path $edgePath -Name "(Default)" -Value $chromeManifest
Write-Host "[OK] Edge: $edgePath" -ForegroundColor Green

# Registrar para Brave (usa la misma ruta que Chrome en Windows)
$bravePath = "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.vaultlocal.app"
New-Item -Path $bravePath -Force | Out-Null
Set-ItemProperty -Path $bravePath -Name "(Default)" -Value $chromeManifest
Write-Host "[OK] Brave: $bravePath" -ForegroundColor Green

# Registrar para Mozilla Firefox
$firefoxPath = "HKCU:\Software\Mozilla\NativeMessagingHosts\com.vaultlocal.app"
New-Item -Path $firefoxPath -Force | Out-Null
Set-ItemProperty -Path $firefoxPath -Name "(Default)" -Value $firefoxManifest
Write-Host "[OK] Firefox: $firefoxPath" -ForegroundColor Green

Write-Host ""
Write-Host "Native messaging host registrado para Chrome, Edge, Brave y Firefox." -ForegroundColor Cyan
Write-Host ""
Write-Host "NOTA: Para Opera, Vivaldi, Arc u otros navegadores basados en Chromium," -ForegroundColor Yellow
Write-Host "      el registro de Chrome suele funcionar automaticamente." -ForegroundColor Yellow
Write-Host ""
Write-Host "IMPORTANTE: Despues de instalar la extension en el navegador," -ForegroundColor Yellow
Write-Host "            reemplaza EXTENSION_ID_HERE en com.vaultlocal.app.json" -ForegroundColor Yellow
Write-Host "            con el ID real de la extension." -ForegroundColor Yellow
Write-Host ""
