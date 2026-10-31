// Helpers de telemetría: logs, métricas y trazas con la API de OpenTelemetry.
// Si el SDK no está activo (Render, pruebas), la API funciona como no-op
// y solo queda el log en consola.

const { trace, metrics, logs, context, SeverityNumber, SpanStatusCode } = require('@opentelemetry/api');

const NOMBRE = 'una-chat';
const tracer = trace.getTracer(NOMBRE);
const meter = metrics.getMeter(NOMBRE);
const otelLogger = logs.getLogger(NOMBRE);

// ---------- Métricas ----------
// En Grafana (Prometheus/Mimir) aparecen con estos nombres:
//   una_chat_http_requests_total
//   una_chat_http_request_duration_seconds_bucket / _sum / _count
//   una_chat_mensajes_total
//   una_chat_mensaje_duration_seconds_bucket / _sum / _count
//   una_chat_errores_total
// Entorno de origen (local) también como etiqueta de cada métrica,
// para filtrar en Prometheus sin tener que unir con target_info.
const ENTORNO = (/deployment\.environment(?:\.name)?=([^,]+)/.exec(process.env.OTEL_RESOURCE_ATTRIBUTES || '') || [])[1] || 'local';

function conEntorno(instrumento, metodo) {
  return {
    [metodo]: function (valor, atributos) {
      instrumento[metodo](valor, Object.assign({ 'deployment.environment': ENTORNO }, atributos));
    },
  };
}

const instrumentos = {
  solicitudes: meter.createCounter('una_chat_http_requests', {
    description: 'Solicitudes HTTP recibidas por UNA Chat',
  }),
  duracionHttp: meter.createHistogram('una_chat_http_request_duration', {
    description: 'Tiempo de respuesta de las solicitudes HTTP',
    unit: 's',
    advice: { explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] },
  }),
  mensajes: meter.createCounter('una_chat_mensajes', {
    description: 'Mensajes procesados por el chat',
  }),
  duracionMensaje: meter.createHistogram('una_chat_mensaje_duration', {
    description: 'Tiempo de procesamiento de un mensaje (validación + reenvío)',
    unit: 's',
    advice: { explicitBucketBoundaries: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25] },
  }),
  errores: meter.createCounter('una_chat_errores', {
    description: 'Errores registrados por UNA Chat',
  }),
};

const metricas = {
  solicitudes: conEntorno(instrumentos.solicitudes, 'add'),
  duracionHttp: conEntorno(instrumentos.duracionHttp, 'record'),
  mensajes: conEntorno(instrumentos.mensajes, 'add'),
  duracionMensaje: conEntorno(instrumentos.duracionMensaje, 'record'),
  errores: conEntorno(instrumentos.errores, 'add'),
};

// ---------- Logs ----------
// Cada log sale en consola (JSON) y, si OTel está activo, se envía a Loki.
// El log hereda el trace_id y span_id de la traza activa: así se relacionan en Grafana.
function idsTrazaActiva() {
  const span = trace.getSpan(context.active());
  const ctx = span && span.spanContext();
  if (!ctx || !trace.isSpanContextValid(ctx)) return {};
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}

function crearLog(nivel, severityNumber) {
  return function (mensaje, atributos) {
    const attrs = atributos || {};
    const linea = Object.assign({ time: new Date().toISOString(), level: nivel, msg: mensaje }, attrs, idsTrazaActiva());
    (nivel === 'error' ? console.error : console.log)(JSON.stringify(linea));
    otelLogger.emit({
      severityNumber: severityNumber,
      severityText: nivel.toUpperCase(),
      body: mensaje,
      attributes: attrs,
    });
  };
}

const log = {
  info: crearLog('info', SeverityNumber.INFO),
  warn: crearLog('warn', SeverityNumber.WARN),
  error: crearLog('error', SeverityNumber.ERROR),
};

// Ejecuta fn dentro de un span hijo. Marca el span con error si fn lanza.
function conSpan(nombre, atributos, fn) {
  return tracer.startActiveSpan(nombre, { attributes: atributos }, function (span) {
    try {
      return fn(span);
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

module.exports = { tracer, metricas, log, conSpan, idsTrazaActiva, SpanStatusCode };
