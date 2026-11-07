/**
 * Pruebas de integración del login con Auth0 (sin red: no se llama a Auth0 ni a Vault).
 * Se monta el router de auth en una app propia con un secreto de prueba.
 */
const express = require('express');
const request = require('supertest');
const { createAuth, configDesdeEntorno } = require('../../server/auth');
const { uriSinParametrosSsl, describirConexion } = require('../../server/vault');

const SECRETO_PRUEBA = 'secreto-de-prueba-que-no-es-real-0123456789';

function appConAuth() {
  const auth = createAuth(configDesdeEntorno({
    AUTH0_DOMAIN: 'https://una-chat-test.us.auth0.com/',
    AUTH0_CLIENT_ID: 'client-id-publico',
    APP_BASE_URL: 'https://una-chat.onrender.com/',
  }));
  auth.setClientSecret(SECRETO_PRUEBA);
  const app = express();
  app.use(auth.router);
  app.get('/sala', auth.requireSession, (req, res) => res.send('sala de ' + req.user.name));
  return { app, auth };
}

describe('Login activo (Auth0)', () => {
  test('GET /auth/config responde 200 con enabled, dominio y Client ID, sin el secreto', async () => {
    const { app } = appConAuth();
    const res = await request(app).get('/auth/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, domain: 'una-chat-test.us.auth0.com', clientId: 'client-id-publico' });
    expect(res.text).not.toContain(SECRETO_PRUEBA);
  });

  test('GET /sala sin cookie responde 401 y pide iniciar sesión', async () => {
    const { app } = appConAuth();
    const html = await request(app).get('/sala').set('accept', 'text/html');
    expect(html.status).toBe(401);
    expect(html.text).toContain('/auth/login');

    const json = await request(app).get('/sala').set('accept', 'application/json');
    expect(json.status).toBe(401);
    expect(json.body.login).toBe('/auth/login');
  });

  test('GET /auth/login redirige (302) al dominio de Auth0 con PKCE', async () => {
    const { app } = appConAuth();
    const res = await request(app).get('/auth/login');
    expect(res.status).toBe(302);
    const destino = new URL(res.headers.location);
    expect(destino.origin).toBe('https://una-chat-test.us.auth0.com');
    expect(destino.pathname).toBe('/authorize');
    expect(destino.searchParams.get('client_id')).toBe('client-id-publico');
    expect(destino.searchParams.get('redirect_uri')).toBe('https://una-chat.onrender.com/auth/callback');
    expect(destino.searchParams.get('code_challenge_method')).toBe('S256');
    expect(destino.searchParams.get('state')).toBeTruthy();
    expect(res.headers.location).not.toContain(SECRETO_PRUEBA);
    // cookie de transacción segura
    expect(res.headers['set-cookie'].join(';')).toMatch(/una_auth_tx=.*HttpOnly.*Secure/i);
  });

  test('GET /sala con una sesión firmada responde 200', async () => {
    const { app, auth } = appConAuth();
    const cookie = 'una_sesion=' + auth._crearSesion({ sub: 'auth0|1', name: 'Krys', email: 'k@example.com' });
    const res = await request(app).get('/sala').set('cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.text).toBe('sala de Krys');
  });

  test('una sesión alterada o firmada con otro secreto se rechaza', async () => {
    const { app, auth } = appConAuth();
    const valida = auth._crearSesion({ sub: 'auth0|1', name: 'Krys', email: '' });
    const alterada = valida.replace(/^[^.]+/, Buffer.from(JSON.stringify({ name: 'Otra', exp: 9999999999 })).toString('base64url'));
    expect((await request(app).get('/sala').set('cookie', 'una_sesion=' + alterada)).status).toBe(401);

    // tras rotar el secreto, las sesiones anteriores dejan de valer
    auth.setClientSecret('otro-secreto-rotado-0123456789abcdef');
    expect((await request(app).get('/sala').set('cookie', 'una_sesion=' + valida)).status).toBe(401);
  });

  test('callback sin transacción válida responde 400', async () => {
    const { app } = appConAuth();
    const res = await request(app).get('/auth/callback?code=x&state=y');
    expect(res.status).toBe(400);
  });

  test('logout redirige al logout de Auth0 con returnTo', async () => {
    const { app } = appConAuth();
    const res = await request(app).get('/auth/logout');
    expect(res.status).toBe(302);
    const destino = new URL(res.headers.location);
    expect(destino.pathname).toBe('/v2/logout');
    expect(destino.searchParams.get('returnTo')).toBe('https://una-chat.onrender.com');
  });
});

describe('Login desactivado (sin AUTH0_DOMAIN / AUTH0_CLIENT_ID)', () => {
  test('/auth/config indica enabled false y /sala queda abierta', async () => {
    const auth = createAuth(configDesdeEntorno({}));
    const app = express();
    app.use(auth.router);
    app.get('/sala', auth.requireSession, (req, res) => res.send('ok'));
    expect((await request(app).get('/auth/config')).body).toEqual({ enabled: false });
    expect((await request(app).get('/sala')).status).toBe(200);
  });
});

describe('Conexión a Vault', () => {
  test('quita sslmode de la URI y no muestra la contraseña en los logs', () => {
    const uri = 'postgresql://una_chat_backend.abcd:p%40ss@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';
    expect(uriSinParametrosSsl(uri).searchParams.has('sslmode')).toBe(false);
    const d = describirConexion(uri);
    expect(d).toBe('una_chat_backend.abcd@aws-0-us-east-1.pooler.supabase.com:5432/postgres');
    expect(d).not.toContain('p%40ss');
  });
});
