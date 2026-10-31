// Se carga ANTES que express y socket.io (primera línea de server.js)
// para que OpenTelemetry pueda instrumentarlos.

// .env solo existe en local. En Render las variables vienen de Environment del servicio.
require('dotenv').config({ quiet: true });

// Parte 2 y 3: Grafana Cloud (solo si OTEL_EXPORTER_OTLP_ENDPOINT tiene valor).
const { otelActivo } = require('./otel');

// Parte 1: Sentry (solo si SENTRY_DSN tiene valor; se configura en Render).
const Sentry = require('@sentry/node');
const sentryActivo = Boolean((process.env.SENTRY_DSN || '').trim()) && process.env.NODE_ENV !== 'test';

if (sentryActivo) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || (process.env.RENDER ? 'render' : 'local'),
    release: process.env.RENDER_GIT_COMMIT,
    sendDefaultPii: false, // no enviar IP ni datos personales
    tracesSampleRate: 0,   // Sentry solo para errores; las trazas van a Grafana
  });
  console.log('[sentry] monitoreo de errores activo');
}

module.exports = { Sentry, sentryActivo, otelActivo };
