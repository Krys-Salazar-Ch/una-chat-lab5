// npm install para descargar los paquetes...

// Monitoreo: debe cargarse antes que express y socket.io.
var { Sentry, sentryActivo } = require('./instrument');

// librerías
var path = require('path');
var crypto = require('crypto');
var express = require('express');
var validation = require('./libs/unalib');
var { tracer, metricas, log, conSpan, idsTrazaActiva, SpanStatusCode } = require('./libs/telemetria');

var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var port = process.env.PORT || 3000;

// Fallo controlado (partes 2 y 3): solo si ENABLE_FAULT_INJECTION=true en el .env local.
var FALLO_ACTIVO = process.env.ENABLE_FAULT_INJECTION === 'true';
var COMANDO_FALLO = '/fallo';

// ---------- Métricas HTTP: solicitudes, tiempo de respuesta y errores ----------
app.use(function (req, res, next) {
  var inicio = process.hrtime.bigint();
  var ids = idsTrazaActiva();
  if (ids.trace_id) res.setHeader('x-trace-id', ids.trace_id);

  res.on('finish', function () {
    var segundos = Number(process.hrtime.bigint() - inicio) / 1e9;
    var ruta = req.route ? (req.baseUrl || '') + req.route.path : rutaSinHandler(req.path);
    var atributos = {
      'http.request.method': req.method,
      'http.route': ruta,
      'http.response.status_code': res.statusCode,
      resultado: res.statusCode >= 400 ? 'error' : 'ok',
    };
    metricas.solicitudes.add(1, atributos);
    metricas.duracionHttp.record(segundos, atributos);
  });
  next();
});

function rutaSinHandler(p) {
  if (p.startsWith('/socket.io')) return '/socket.io';
  if (p.startsWith('/vendor') || p.startsWith('/media')) return '/estaticos';
  return 'sin_ruta';
}

// root: presentar html
app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Disponibilidad (Cronitor y healthcheck de Docker)
app.get('/health', function (req, res) {
  res.json({ status: 'ok', uptime_s: Math.round(process.uptime()) });
});

// jQuery servido localmente (no depende de un CDN)
app.use('/vendor/jquery', express.static(path.join(__dirname, 'node_modules', 'jquery', 'dist')));

// medios de prueba locales (imagen y video estables para las pruebas E2E)
app.use('/media', express.static(path.join(__dirname, 'public', 'media')));

// ---------- Procesamiento de mensajes (Socket.IO y HTTP comparten la lógica) ----------
function procesarMensaje(msg, canal) {
  return tracer.startActiveSpan('chat.procesar_mensaje', { attributes: { 'chat.canal': canal } }, function (span) {
    var inicio = process.hrtime.bigint();
    var tipo = 'desconocido';
    var resultado = 'ok';
    try {
      var texto = extraerTexto(msg);
      span.setAttribute('chat.mensaje.longitud', texto.length);

      if (FALLO_ACTIVO && texto.trim() === COMANDO_FALLO) {
        throw new Error('Fallo controlado: mensaje de prueba "' + COMANDO_FALLO + '"');
      }

      // toda entrada pasa por una-lib antes de reenviarse
      var seguro = conSpan('unalib.validarMensaje', {}, function (s) {
        var r = validation.validarMensaje(msg);
        tipo = JSON.parse(r).tipo;
        s.setAttribute('chat.tipo', tipo);
        return r;
      });
      span.setAttribute('chat.tipo', tipo);

      conSpan('socketio.reenviar_mensaje', { 'chat.tipo': tipo }, function () {
        io.emit('Evento-Mensaje-Server', seguro);
      });

      if (tipo === 'bloqueado') {
        log.warn('Intento de inyección bloqueado', { canal: canal, tipo: tipo });
      } else {
        log.info('Mensaje procesado', { canal: canal, tipo: tipo, longitud: texto.length });
      }
      return { seguro: seguro, tipo: tipo };
    } catch (err) {
      resultado = 'error';
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      metricas.errores.add(1, { origen: 'procesar_mensaje', canal: canal });
      log.error('Error al procesar mensaje', { canal: canal, error: err.message });
      throw err;
    } finally {
      var segundos = Number(process.hrtime.bigint() - inicio) / 1e9;
      metricas.mensajes.add(1, { canal: canal, tipo: tipo, resultado: resultado });
      metricas.duracionMensaje.record(segundos, { canal: canal, resultado: resultado });
      span.end();
    }
  });
}

function extraerTexto(msg) {
  try {
    var obj = typeof msg === 'string' ? JSON.parse(msg) : msg;
    return obj && typeof obj.mensaje === 'string' ? obj.mensaje : '';
  } catch (e) {
    return typeof msg === 'string' ? msg : '';
  }
}

// escuchar una conexión por socket
io.on('connection', function (socket) {
  socket.on('Evento-Mensaje-Server', function (msg) {
    try {
      procesarMensaje(msg, 'socket');
    } catch (err) {
      // solo quien envió el mensaje ve el error
      socket.emit('Evento-Error-Server', 'No se pudo procesar el mensaje: ' + err.message);
    }
  });
});

// ---------- API HTTP para enviar mensajes (usada por Artillery) ----------
// POST /api/mensajes  { "nombre": "...", "mensaje": "...", "color": "#RRGGBB" }
// Si CHAT_API_TOKEN tiene valor, exige el encabezado Authorization: Bearer <token>.
function exigirToken(req, res, next) {
  var esperado = process.env.CHAT_API_TOKEN || '';
  if (!esperado) return next();
  var recibido = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  var a = Buffer.from(recibido);
  var b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    log.warn('Solicitud sin token válido', { ruta: '/api/mensajes' });
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

app.post('/api/mensajes', exigirToken, express.json({ limit: '10kb' }), function (req, res) {
  var body = req.body || {};
  if (typeof body.mensaje !== 'string' || !body.mensaje.trim() || body.mensaje.length > 1000) {
    log.warn('Mensaje rechazado: cuerpo inválido', { canal: 'http' });
    return res.status(400).json({ error: 'El campo "mensaje" es obligatorio (máx. 1000 caracteres)' });
  }
  var r = procesarMensaje(JSON.stringify({ nombre: body.nombre, mensaje: body.mensaje, color: body.color }), 'http');
  res.status(201).json({ ok: true, tipo: r.tipo, respuesta: JSON.parse(r.seguro) });
});

// ---------- Error controlado para Sentry (parte 1) ----------
// Temporal: solo existe si SENTRY_TEST_ROUTE=true. Al terminar la prueba,
// borre esa variable en Render (o elimine este bloque).
if (process.env.SENTRY_TEST_ROUTE === 'true') {
  app.get('/debug-sentry', function () {
    throw new Error('Error controlado de prueba para Sentry (laboratorio de monitoreo)');
  });
}

// ---------- Manejo de errores ----------
if (sentryActivo) {
  Sentry.setupExpressErrorHandler(app);
}

// eslint-disable-next-line no-unused-vars
app.use(function (err, req, res, next) {
  if (!err.status || err.status >= 500) {
    metricas.errores.add(1, { origen: 'http', 'http.route': req.route ? req.route.path : req.path });
    log.error('Error en solicitud HTTP', { ruta: req.path, metodo: req.method, error: err.message });
  }
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Error interno del servidor' });
});

// Solo escucha el puerto si se ejecuta directamente (npm start).
// Las pruebas de integración importan app/http/io y abren su propio puerto.
if (require.main === module) {
  http.listen(port, function () {
    console.log('listening on *:' + port);
    log.info('UNA Chat iniciado', { puerto: Number(port), fallo_controlado: FALLO_ACTIVO });
  });
}

module.exports = { app: app, http: http, io: io };
