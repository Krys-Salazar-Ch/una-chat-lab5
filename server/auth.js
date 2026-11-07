// Inicio de sesión con Auth0 (Authorization Code + PKCE, client_secret_post).
//
// Rutas:
//   GET /auth/config    → { enabled, domain, clientId }  (nunca el secreto)
//   GET /auth/login     → 302 a https://AUTH0_DOMAIN/authorize
//   GET /auth/callback  → canjea el código, crea la sesión y vuelve a /sala
//   GET /auth/logout    → borra la sesión y cierra sesión en Auth0
//   GET /auth/me        → usuario de la sesión o 401
//
// Si AUTH0_DOMAIN o AUTH0_CLIENT_ID están vacíos, el login queda desactivado
// y el chat sigue abierto (así funcionan las pruebas).
//
// La sesión es una cookie HttpOnly firmada con HMAC. La llave de firma se
// deriva del Client Secret (o de SESSION_SECRET si existe): sobrevive a un
// redeploy y se invalida sola cuando el secreto se rota.

var crypto = require('crypto');
var express = require('express');

var COOKIE_SESION = 'una_sesion';
var COOKIE_TX = 'una_auth_tx';
var DURACION_SESION_S = 8 * 60 * 60;
var DURACION_TX_S = 10 * 60;
var CODIGO_PRUEBA = 'vault-startup-probe';

function configDesdeEntorno(env) {
  env = env || process.env;
  var domain = (env.AUTH0_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  var clientId = (env.AUTH0_CLIENT_ID || '').trim();
  var port = env.PORT || 3000;
  var baseUrl = (env.APP_BASE_URL || ('http://localhost:' + port)).trim().replace(/\/+$/, '');
  return {
    enabled: Boolean(domain && clientId),
    domain: domain,
    clientId: clientId,
    baseUrl: baseUrl,
    sessionSecret: env.SESSION_SECRET || '',
  };
}

// ---------- utilidades ----------
function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function leerCookies(header) {
  var out = {};
  (header || '').split(';').forEach(function (par) {
    var i = par.indexOf('=');
    if (i < 0) return;
    var k = par.slice(0, i).trim();
    var v = par.slice(i + 1).trim();
    if (k) {
      try { out[k] = decodeURIComponent(v); } catch (e) { out[k] = v; }
    }
  });
  return out;
}

function escaparHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function decodificarJwt(jwt) {
  var partes = String(jwt || '').split('.');
  if (partes.length !== 3) throw new Error('id_token con formato inválido');
  return JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
}

// ---------- módulo ----------
function createAuth(config) {
  config = config || configDesdeEntorno();
  var clientSecret = null;
  var llave = null;
  var seguro = config.baseUrl.startsWith('https://');
  var callbackUrl = config.baseUrl + '/auth/callback';
  var emisor = 'https://' + config.domain + '/';

  function setClientSecret(secreto) {
    clientSecret = secreto;
    var base = config.sessionSecret || secreto;
    llave = Buffer.from(crypto.hkdfSync('sha256', base, 'una-chat', 'una-chat-session-v1', 32));
  }

  function firmar(datos) {
    var cuerpo = b64url(JSON.stringify(datos));
    var firma = crypto.createHmac('sha256', llave).update(cuerpo).digest('base64url');
    return cuerpo + '.' + firma;
  }

  function verificar(valor) {
    if (!valor || !llave) return null;
    var i = valor.lastIndexOf('.');
    if (i < 0) return null;
    var cuerpo = valor.slice(0, i);
    var firma = Buffer.from(valor.slice(i + 1));
    var esperada = Buffer.from(crypto.createHmac('sha256', llave).update(cuerpo).digest('base64url'));
    if (firma.length !== esperada.length || !crypto.timingSafeEqual(firma, esperada)) return null;
    try {
      var datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
      if (!datos.exp || datos.exp < Math.floor(Date.now() / 1000)) return null;
      return datos;
    } catch (e) {
      return null;
    }
  }

  function opcionesCookie(maxAgeS, ruta) {
    return { httpOnly: true, secure: seguro, sameSite: 'lax', path: ruta || '/', maxAge: maxAgeS * 1000 };
  }

  function usuarioDe(headerCookie) {
    if (!config.enabled) return null;
    return verificar(leerCookies(headerCookie)[COOKIE_SESION]);
  }

  function crearSesion(usuario) {
    var ahora = Math.floor(Date.now() / 1000);
    return firmar({ sub: usuario.sub, name: usuario.name, email: usuario.email, iat: ahora, exp: ahora + DURACION_SESION_S });
  }

  async function canjearCodigo(code, verifier) {
    var cuerpo = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: clientSecret, // client_secret_post
      code: code,
      redirect_uri: callbackUrl,
      code_verifier: verifier,
    });
    var resp = await fetch('https://' + config.domain + '/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: cuerpo,
      signal: AbortSignal.timeout(10000),
    });
    var json = await resp.json().catch(function () { return {}; });
    return { status: resp.status, body: json };
  }

  // Prueba de arranque: un código falso con el secreto de Vault.
  // invalid_grant = Auth0 aceptó el secreto (lo esperado). invalid_client = secreto incorrecto.
  async function probarSecreto() {
    var r = await canjearCodigo(CODIGO_PRUEBA, b64url(crypto.randomBytes(32)));
    var error = r.body && r.body.error;
    return { status: r.status, error: error, secretoAceptado: error === 'invalid_grant' };
  }

  function listo() {
    return config.enabled && clientSecret !== null;
  }

  // ---------- rutas ----------
  var router = express.Router();

  router.get('/auth/config', function (req, res) {
    res.set('cache-control', 'no-store');
    if (!config.enabled) return res.json({ enabled: false });
    res.json({ enabled: true, domain: config.domain, clientId: config.clientId });
  });

  router.get('/auth/me', function (req, res) {
    res.set('cache-control', 'no-store');
    if (!config.enabled) return res.json({ enabled: false, user: null });
    var u = usuarioDe(req.headers.cookie);
    if (!u) return res.status(401).json({ enabled: true, error: 'No hay sesión' });
    res.json({ enabled: true, user: { name: u.name, email: u.email } });
  });

  router.get('/auth/login', function (req, res) {
    if (!config.enabled) return res.redirect('/');
    if (!listo()) return res.status(503).json({ error: 'Login no disponible todavía' });
    var verifier = b64url(crypto.randomBytes(32));
    var state = b64url(crypto.randomBytes(16));
    var nonce = b64url(crypto.randomBytes(16));
    var challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    var tx = firmar({ state: state, nonce: nonce, verifier: verifier, exp: Math.floor(Date.now() / 1000) + DURACION_TX_S });
    res.cookie(COOKIE_TX, tx, opcionesCookie(DURACION_TX_S, '/auth'));

    var params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: callbackUrl,
      scope: 'openid profile email',
      state: state,
      nonce: nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    res.redirect(302, 'https://' + config.domain + '/authorize?' + params.toString());
  });

  router.get('/auth/callback', async function (req, res, next) {
    if (!config.enabled) return res.redirect('/');
    try {
      var tx = verificar(leerCookies(req.headers.cookie)[COOKIE_TX]);
      res.clearCookie(COOKIE_TX, { path: '/auth' });
      if (req.query.error) {
        return paginaError(res, 401, 'Auth0 rechazó el inicio de sesión: ' + req.query.error);
      }
      if (!tx || typeof req.query.state !== 'string' || req.query.state !== tx.state || typeof req.query.code !== 'string') {
        return paginaError(res, 400, 'La solicitud de inicio de sesión expiró o no es válida.');
      }

      var r = await canjearCodigo(req.query.code, tx.verifier);
      if (r.status !== 200 || !r.body.id_token) {
        console.error('[auth] canje de código falló: HTTP ' + r.status + ' ' + (r.body.error || ''));
        return paginaError(res, 502, 'No se pudo completar el inicio de sesión (' + (r.body.error || r.status) + ').');
      }

      // El id_token llega directo del endpoint de tokens por TLS y con
      // autenticación de cliente, así que basta validar sus claims (OIDC Core 3.1.3.7).
      var claims = decodificarJwt(r.body.id_token);
      var aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      var ahora = Math.floor(Date.now() / 1000);
      if (claims.iss !== emisor || aud.indexOf(config.clientId) < 0 || !(claims.exp > ahora) || claims.nonce !== tx.nonce) {
        return paginaError(res, 401, 'El token de Auth0 no es válido para esta aplicación.');
      }

      var usuario = {
        sub: claims.sub,
        name: claims.name || claims.nickname || claims.email || 'Usuario',
        email: claims.email || '',
      };
      res.cookie(COOKIE_SESION, crearSesion(usuario), opcionesCookie(DURACION_SESION_S));
      res.redirect(302, '/sala');
    } catch (err) {
      next(err);
    }
  });

  router.get('/auth/logout', function (req, res) {
    res.clearCookie(COOKIE_SESION, { path: '/' });
    if (!config.enabled) return res.redirect('/');
    var params = new URLSearchParams({ client_id: config.clientId, returnTo: config.baseUrl });
    res.redirect(302, 'https://' + config.domain + '/v2/logout?' + params.toString());
  });

  function paginaError(res, status, mensaje) {
    res.status(status).type('html').send(
      '<!doctype html><html lang="es"><meta charset="utf-8"><title>UNA Chat</title>' +
      '<body style="font:15px Helvetica,Arial;padding:2rem"><p>' + escaparHtml(mensaje) + '</p>' +
      '<p><a href="/auth/login">Iniciar sesión</a></p></body></html>'
    );
  }

  // Protege una ruta HTTP: 401 si no hay sesión.
  function requireSession(req, res, next) {
    if (!config.enabled) return next();
    var u = usuarioDe(req.headers.cookie);
    if (u) {
      req.user = u;
      return next();
    }
    if (req.accepts(['html', 'json']) === 'json') {
      return res.status(401).json({ error: 'Iniciá sesión', login: '/auth/login' });
    }
    paginaError(res, 401, 'Iniciá sesión para entrar a la sala de UNA Chat.');
  }

  // Protege Socket.IO: solo conexiones con sesión válida.
  function socketMiddleware(socket, next) {
    if (!config.enabled) return next();
    var u = usuarioDe(socket.request.headers.cookie);
    if (!u) return next(new Error('No autorizado'));
    socket.data.user = u;
    next();
  }

  return {
    config: config,
    router: router,
    requireSession: requireSession,
    socketMiddleware: socketMiddleware,
    setClientSecret: setClientSecret,
    probarSecreto: probarSecreto,
    listo: listo,
    // solo para pruebas
    _crearSesion: crearSesion,
  };
}

module.exports = { createAuth, configDesdeEntorno, leerCookies, CODIGO_PRUEBA };
