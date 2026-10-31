# Monitoreo de UNA Chat

| Parte | Dónde corre el chat | Herramientas | Qué se activa |
|---|---|---|---|
| 1 | Render (`https://una-chat-lab5-nzw6.onrender.com`) | Cronitor, Sentry | `SENTRY_DSN` en Environment de Render |
| 2 | Local con `npm start` | Grafana Cloud (logs, métricas y trazas) | `.env` local con `OTEL_*` |
| 3 | Local en Docker + Artillery | Grafana Cloud | `.env` local leído por `docker-compose.yml` |

Render **no** tiene variables `OTEL_*`, así que no envía nada a Grafana. Las credenciales solo existen en `.env`, que está en `.gitignore`.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `instrument.js` | Se carga primero en `server.js`. Lee `.env`, inicia OpenTelemetry y Sentry si sus variables tienen valor. |
| `otel.js` | OpenTelemetry SDK para Node.js: exporta trazas, métricas y logs por OTLP (http/protobuf) a Grafana Cloud. Instrumenta automáticamente HTTP, Express y Socket.IO. |
| `libs/telemetria.js` | Logs (consola + Loki, con `trace_id`), métricas propias y spans del procesamiento de mensajes. |
| `server.js` | `/health`, `POST /api/mensajes`, métricas HTTP, fallo controlado y ruta temporal `/debug-sentry`. |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore` | Contenedor del chat. |
| `artillery/carga.yml` | Prueba de carga: 5 solicitudes/s durante 60 s a `POST /api/mensajes` en `localhost:3000`. |
| `.env.example` | Lista de variables, sin valores. |

## Integración elegida

Se usa **OpenTelemetry para Node.js** con exportación directa al **gateway OTLP de Grafana Cloud**. No se instala Grafana, Alloy ni un collector local. Grafana Cloud guarda cada señal en su backend:

- Trazas → **Tempo**
- Logs → **Loki**
- Métricas → **Mimir** (Prometheus)

Recorrido de los datos: UNA Chat (local o Docker) → SDK OpenTelemetry → HTTPS OTLP con encabezado `Authorization` (leído del `.env`) → Grafana Cloud → consulta en Explore.

Cada señal lleva `service.name=una-chat` y `deployment.environment=local`. Cada log que ocurre dentro de una solicitud lleva el `trace_id` de su traza, y la respuesta HTTP lo devuelve en el encabezado `x-trace-id`.

## Señales que genera la app

**Trazas**
- `POST /api/mensajes` (HTTP) → `chat.procesar_mensaje` → `unalib.validarMensaje` → `socketio.reenviar_mensaje`
- Mensajes por Socket.IO: mismo `chat.procesar_mensaje` con `chat.canal=socket`
- Un fallo marca el span en rojo (status ERROR) con la excepción

**Métricas** (nombres en Prometheus)
- `una_chat_http_requests_total`: etiquetas `http_route`, `http_response_status_code`, `resultado`
- `una_chat_http_request_duration_seconds_*`: tiempo de respuesta
- `una_chat_mensajes_total`: etiquetas `canal`, `tipo`, `resultado`
- `una_chat_mensaje_duration_seconds_*`: tiempo de procesamiento de un mensaje
- `una_chat_errores_total`

**Logs**
- `Mensaje procesado`
- `Intento de inyección bloqueado`
- `Error al procesar mensaje`
- `Error en solicitud HTTP`
- `Mensaje rechazado: cuerpo inválido`

## Fallo controlado (partes 2 y 3)

Con `ENABLE_FAULT_INJECTION=true` en `.env`, enviar el mensaje **`/fallo`** provoca un error controlado:

- En el chat aparece un aviso rojo, solo para quien lo envió.
- Por HTTP, `POST /api/mensajes` responde 500.
- En Render la variable no existe, así que `/fallo` es un mensaje normal.

## Error de prueba para Sentry (parte 1)

1. En Render → Environment, agregar `SENTRY_DSN` y `SENTRY_TEST_ROUTE=true`.
2. Abrir `https://una-chat-lab5-nzw6.onrender.com/debug-sentry`. Responde 500 y Sentry recibe el error.
3. Retirar el mecanismo: borrar `SENTRY_TEST_ROUTE` en Render. La ruta vuelve a dar 404.

## Comandos

```bash
# Parte 2: local
npm install
cp .env.example .env        # completar OTEL_EXPORTER_OTLP_ENDPOINT y OTEL_EXPORTER_OTLP_HEADERS
npm start                   # http://localhost:3000

# Parte 3.1: Docker
docker compose up --build   # http://localhost:3000
docker ps                   # contenedor una-chat (healthy)
docker compose logs -f      # logs JSON con trace_id

# Parte 3.2: Artillery (en otra terminal, con el contenedor arriba)
npm install -g artillery
artillery run artillery/carga.yml --output artillery/reporte.json
artillery report artillery/reporte.json   # opcional: reporte HTML
```

Si se usa `CHAT_API_TOKEN`, debe estar también en la terminal donde corre Artillery:

- PowerShell: `$env:CHAT_API_TOKEN="..."`
- bash: `export CHAT_API_TOKEN=...`

## Consultas en Grafana Cloud (Explore)

Filtre siempre por el intervalo de la prueba (selector de tiempo arriba a la derecha).

**Loki (logs)**

```logql
{service_name="una-chat"} | deployment_environment="local"
{service_name="una-chat"} |= "Error"
{service_name="una-chat"} | trace_id="<trace_id>"
```

Si `deployment_environment` no aparece como filtro, ábralo desde *Labels* o *Structured metadata* de un log.

**Prometheus / Mimir (métricas)**

```promql
# Solicitudes por segundo, por código de respuesta
sum by (http_response_status_code) (rate(una_chat_http_requests_total{deployment_environment="local"}[1m]))

# Latencia p50 y p95 (segundos)
histogram_quantile(0.50, sum by (le) (rate(una_chat_http_request_duration_seconds_bucket{deployment_environment="local", http_route="/api/mensajes"}[1m])))
histogram_quantile(0.95, sum by (le) (rate(una_chat_http_request_duration_seconds_bucket{deployment_environment="local", http_route="/api/mensajes"}[1m])))

# Porcentaje de errores
100 * sum(rate(una_chat_http_requests_total{deployment_environment="local", resultado="error"}[1m]))
    / sum(rate(una_chat_http_requests_total{deployment_environment="local"}[1m]))

# Total de solicitudes en el intervalo de la prueba
sum(increase(una_chat_http_requests_total{deployment_environment="local", http_route="/api/mensajes"}[2m]))
```

**Tempo (trazas)**

```traceql
{ resource.service.name = "una-chat" && resource.deployment.environment = "local" }
{ resource.service.name = "una-chat" && status = error }
```
