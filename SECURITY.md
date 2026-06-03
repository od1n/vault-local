# Politica de seguridad

## Versiones soportadas

| Version | Soporte          |
| ------- | ---------------- |
| 0.1.x   | Actualizaciones de seguridad |

## Reportar una vulnerabilidad

Si descubres una vulnerabilidad de seguridad en Vault Local, te pedimos que la reportes de forma responsable.

**No abras un issue publico en GitHub.** Las vulnerabilidades reportadas publicamente ponen en riesgo a todos los usuarios antes de que exista un parche.

### Como reportar

Envia un correo a: **security@vaultlocal.dev**

Incluye la siguiente informacion:

- Descripcion clara de la vulnerabilidad.
- Pasos para reproducirla.
- Impacto potencial (que datos o funcionalidad se ven afectados).
- Version de Vault Local afectada.
- Sistema operativo y version.

### Que esperar

- **Confirmacion de recepcion**: dentro de 72 horas.
- **Evaluacion inicial**: dentro de 7 dias.
- **Resolucion**: trabajaremos contigo para entender el problema y desarrollar un parche lo antes posible.
- **Divulgacion coordinada**: publicaremos un advisory de seguridad una vez que el parche este disponible.

### Alcance

Los siguientes tipos de problemas se consideran vulnerabilidades de seguridad:

- Bypass del cifrado o acceso a datos sin la contraseña maestra.
- Fuga de claves o datos descifrados en memoria, logs o archivos temporales.
- Ataques de path traversal en importacion/exportacion de archivos.
- Inyeccion de codigo (SQL injection, XSS en la interfaz Tauri).
- Debilidades en la derivacion de claves (KDF) o en los algoritmos de cifrado.
- Bypass del bloqueo por intentos fallidos.

Los siguientes **no** se consideran vulnerabilidades de seguridad:

- Ataques que requieren acceso fisico al dispositivo desbloqueado.
- Ataques de denegacion de servicio (DoS) locales.
- Problemas de usabilidad o funcionalidad que no afectan la seguridad.

## Salon de la fama

Agradecemos a las siguientes personas por reportar vulnerabilidades de forma responsable:

<!-- Agrega tu nombre aqui despues de un reporte verificado -->

*Esta lista se actualizara conforme se reciban reportes.*
