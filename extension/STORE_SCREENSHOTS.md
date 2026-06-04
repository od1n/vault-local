# Screenshots necesarios para Chrome Web Store

Toma estas capturas de pantalla (1280x800 px):

1. **Popup conectado** — La extension mostrando credenciales del sitio actual
2. **Popup buscando** — Escribiendo en el campo de busqueda con resultados
3. **App desktop** — La aplicacion de escritorio mostrando el dashboard
4. **Autofill en accion** — Un formulario de login con los campos completados

Herramientas:
- Windows: Win+Shift+S (Recortes)
- Redimensionar a 1280x800 con Paint o cualquier editor

## Publicar en Chrome Web Store

1. Ve a https://chrome.google.com/webstore/devconsole
2. Paga $5 de registro unico (con tarjeta o PayPal)
3. Click "New Item"
4. Sube el ZIP de la extension (ver abajo)
5. Completa la listing con los datos de STORE_LISTING.md
6. Sube screenshots
7. Submit para revision (tarda 1-3 dias)

## Crear el ZIP

```powershell
cd "D:\Desarrollo\Claude\Projects\Caja Segura\vault-local\extension"
# Excluir archivos innecesarios
Compress-Archive -Path manifest.json, background, content, popup, icons -DestinationPath vault-local-extension.zip -Force
```
