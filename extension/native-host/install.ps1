# Vault Local — Registrar Native Messaging Host para Chrome, Edge, Brave y Firefox.
# Ejecutar con: powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  Vault Local - Native Messaging Host" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

$hostDir = $PSScriptRoot
$batPath = Join-Path $hostDir "host.bat"

# Verificar que host.bat existe
if (-not (Test-Path $batPath)) {
    Write-Host "[ERROR] No se encontro: $batPath" -ForegroundColor Red
    exit 1
}

# Verificar que Node.js esta instalado
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
    Write-Host "[ERROR] Node.js no esta instalado o no esta en el PATH" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js encontrado: $nodePath" -ForegroundColor Green

# Detectar el ID de la extension de Chrome
Write-Host ""
$extensionId = Read-Host "Ingresa el ID de la extension de Chrome (de chrome://extensions)"
if ([string]::IsNullOrWhiteSpace($extensionId)) {
    Write-Host "[ERROR] El ID de la extension es obligatorio" -ForegroundColor Red
    exit 1
}

# Generar manifest de Chrome/Edge/Brave con ruta absoluta y ID real
$chromeManifest = @{
    name = "com.vaultlocal.app"
    description = "Vault Local Native Messaging Host"
    path = $batPath
    type = "stdio"
    allowed_origins = @("chrome-extension://$extensionId/")
} | ConvertTo-Json -Depth 3

$chromeManifestPath = Join-Path $hostDir "com.vaultlocal.app.json"
Set-Content -Path $chromeManifestPath -Value $chromeManifest -Encoding UTF8
Write-Host "[OK] Manifest Chrome generado con ID: $extensionId" -ForegroundColor Green

# Generar manifest de Firefox con ruta absoluta
$firefoxManifest = @{
    name = "com.vaultlocal.app"
    description = "Vault Local Native Messaging Host"
    path = $batPath
    type = "stdio"
    allowed_extensions = @("vault-local@vaultlocal.com")
} | ConvertTo-Json -Depth 3

$firefoxManifestPath = Join-Path $hostDir "com.vaultlocal.app.firefox.json"
Set-Content -Path $firefoxManifestPath -Value $firefoxManifest -Encoding UTF8
Write-Host "[OK] Manifest Firefox generado" -ForegroundColor Green

# Registrar para Google Chrome
$chromePath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.vaultlocal.app"
New-Item -Path $chromePath -Force | Out-Null
Set-ItemProperty -Path $chromePath -Name "(Default)" -Value $chromeManifestPath
Write-Host "[OK] Chrome registrado" -ForegroundColor Green

# Registrar para Microsoft Edge
$edgePath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.vaultlocal.app"
New-Item -Path $edgePath -Force | Out-Null
Set-ItemProperty -Path $edgePath -Name "(Default)" -Value $chromeManifestPath
Write-Host "[OK] Edge registrado" -ForegroundColor Green

# Registrar para Brave
$bravePath = "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.vaultlocal.app"
New-Item -Path $bravePath -Force | Out-Null
Set-ItemProperty -Path $bravePath -Name "(Default)" -Value $chromeManifestPath
Write-Host "[OK] Brave registrado" -ForegroundColor Green

# Registrar para Firefox
$firefoxPath = "HKCU:\Software\Mozilla\NativeMessagingHosts\com.vaultlocal.app"
New-Item -Path $firefoxPath -Force | Out-Null
Set-ItemProperty -Path $firefoxPath -Name "(Default)" -Value $firefoxManifestPath
Write-Host "[OK] Firefox registrado" -ForegroundColor Green

Write-Host ""
Write-Host "Instalacion completada." -ForegroundColor Cyan
Write-Host "Reinicia el navegador para que los cambios tomen efecto." -ForegroundColor Yellow
Write-Host ""
