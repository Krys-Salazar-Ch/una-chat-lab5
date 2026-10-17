# UNA Chat — Laboratorio 5 (Seguridad Informática)

Chat con Express + Socket.IO. Esta versión corrige la vulnerabilidad de inyección de scripts (XSS),
permite compartir imágenes y videos de forma segura e incluye tres suites de pruebas.

## Requisitos
- Node.js 18 o superior

## Instalación
```bash
npm install
npx playwright install chromium
```

## Ejecutar
```bash
npm start            # http://localhost:3000
```

## Pruebas
| Suite | Comando | Herramientas |
|---|---|---|
| Unitarias (una-lib) | `npm test` | Jest |
| Integración (backend + una-lib) | `npx jest tests/integration --runInBand --env=node` | Jest, Supertest, socket.io-client |
| End-to-end | `npx playwright test --project=chromium --headed` | Playwright |

Reporte E2E: `npx playwright show-report`

`npm test` solo corre `tests/unit`; `tests/e2e` está en `testPathIgnorePatterns` para que Jest no
intente ejecutar los archivos de Playwright. Si el servidor no está corriendo, Playwright lo levanta solo
(`webServer` en `playwright.config.js`); si ya está abierto con `npm start`, lo reutiliza.

## Qué se corrigió

**Vulnerabilidad original:** el servidor reenviaba el mensaje tal cual y el frontend lo insertaba con
`$(...).html(...)`, así que `<script>alert('Inyección de script');</script>` se ejecutaba en todos
los clientes. Además, `is_valid_url_image` e `is_valid_yt_video` evaluaban una variable inexistente
(`phone`), por lo que nunca reconocían imágenes ni videos.

**`validarMensaje` en `libs/unalib.js`:**
- Escapa todo el texto (`< > & " ' \` / =`) para que se muestre como texto y no como HTML.
- Detecta patrones de inyección (`<script`, `on*=`, `javascript:`, `<iframe`, `<svg`, etc.), marca el mensaje como `bloqueado` y lo muestra escapado.
- Solo genera `<img>`, `<video controls>` o `<iframe>` de YouTube cuando la URL pasa una expresión regular estricta y anclada (`^...$`): solo `http`/`https`, extensiones permitidas y sin comillas ni espacios. La URL se escapa además dentro del atributo.
- Escapa el nombre de usuario y solo acepta colores hexadecimales `#RRGGBB`.
- Devuelve `{ nombre, mensaje, color, tipo }`, donde `tipo` es `imagen | video | texto | bloqueado`.
- `validateMessage` se mantiene como alias por compatibilidad.

**Frontend:** construye el nombre y el mensaje con nodos DOM y `$.parseHTML(..., false)`, que no
ejecuta scripts (defensa en profundidad). jQuery y el cliente de Socket.IO se sirven desde el propio
servidor en vez de un CDN.

**Servidor:** exporta `app`, `http` e `io` y solo abre el puerto con `npm start`, para que las
pruebas de integración usen su propio puerto. Sirve en `/media` una imagen y un video de prueba
(`una.png`, `una.webm`) para que las pruebas E2E no dependan de internet.

## Formatos aceptados
- Imágenes: `.jpg .jpeg .png .gif .bmp .webp .svg`
- Video: YouTube (`watch?v=`, `youtu.be/`, `embed/`, `shorts/`) y archivos `.mp4 .webm .ogg .ogv`

Ejemplos para probar en el chat:
```
http://localhost:3000/media/una.png
http://localhost:3000/media/una.webm
https://www.youtube.com/watch?v=qYwlqx-JLok
<script>alert('Inyección de script');</script>
```
