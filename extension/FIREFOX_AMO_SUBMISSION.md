# Publicar extensión en Firefox Add-ons (AMO)

## Archivo listo

`vault-local-firefox.zip` — extensión empaquetada con manifest V2 para Firefox.

## Pasos

1. **Crear cuenta en AMO**: https://addons.mozilla.org/developers/
   - Usa tu cuenta de Firefox/Mozilla existente o crea una nueva.

2. **Subir la extensión**: https://addons.mozilla.org/developers/addon/submit/distribution
   - Selecciona "On this site" (para distribución en AMO).
   - Sube `vault-local-firefox.zip`.

3. **Formulario de envío**:
   - **Name**: Vault Local
   - **Summary**: Secure autofill for Vault Local — local-only, zero-knowledge password manager. No cloud, no tracking.
   - **Description**: (usar el contenido de STORE_LISTING.md adaptado)
   - **Categories**: Security & Privacy
   - **Tags**: password-manager, security, privacy, autofill, zero-knowledge, offline
   - **Homepage**: https://vault-local.vercel.app
   - **Support URL**: https://github.com/od1n/vault-local/issues
   - **Source code URL**: https://github.com/od1n/vault-local (piden el código fuente para revisión manual)

4. **Screenshots**: Usar las mismas de Chrome Web Store en `store-assets/`.

5. **Enviar para revisión**. La revisión de AMO suele tomar 1-5 días.

## Notas

- El manifest Firefox usa `browser_specific_settings.gecko.id = "vault-local@vaultlocal.com"`.
- `strict_min_version` está en 91.0 (Firefox ESR).
- El native messaging host necesita configuración separada en Firefox (ver `native-host/`).
