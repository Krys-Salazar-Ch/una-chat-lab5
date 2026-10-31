// OpenTelemetry: envía logs, métricas y trazas a Grafana Cloud (OTLP).
//
// Solo se activa si OTEL_EXPORTER_OTLP_ENDPOINT tiene valor. Ese valor existe
// únicamente en el .env local (o en docker-compose), nunca en Render.
// Las credenciales se leen del entorno (OTEL_EXPORTER_OTLP_HEADERS); no van en el código.

const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').trim();
const enTests = process.env.NODE_ENV === 'test';

let sdk = null;

if (endpoint && !enTests) {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
  const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-proto');
  const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-proto');
  const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
  const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
  const { resourceFromAttributes } = require('@opentelemetry/resources');

  // Host de Grafana: no se trazan las peticiones que el propio exportador le hace.
  const collectorHost = new URL(endpoint).host;

  // "local" salvo que OTEL_RESOURCE_ATTRIBUTES diga otra cosa.
  const atributosExtra = process.env.OTEL_RESOURCE_ATTRIBUTES || '';
  const recurso = { 'service.name': process.env.OTEL_SERVICE_NAME || 'una-chat' };
  if (!/deployment\.environment(\.name)?=/.test(atributosExtra)) {
    recurso['deployment.environment'] = 'local';
    recurso['deployment.environment.name'] = 'local';
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes(recurso),
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: 10000, // cada 10 s para ver la prueba de carga con detalle
      }),
    ],
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': {
          ignoreOutgoingRequestHook: (req) => (req.hostname || req.host || '').startsWith(collectorHost.split(':')[0]),
          // archivos estáticos: generan ruido en las trazas
          ignoreIncomingRequestHook: (req) => /^\/(vendor|media|favicon)/.test(req.url || ''),
        },
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log('[otel] telemetría activa → Grafana Cloud (' + collectorHost + ')');

  // Al detener el proceso (Ctrl+C o docker stop) se envía lo pendiente.
  const cerrar = () => {
    sdk.shutdown()
      .catch((e) => console.error('[otel] error al cerrar', e))
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', cerrar);
  process.once('SIGINT', cerrar);
}

module.exports = { otelActivo: Boolean(sdk) };
