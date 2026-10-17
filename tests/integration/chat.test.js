/**
 * Pruebas de integración: backend Node.js (Express + Socket.IO) + una-lib.
 * El envío de mensajes usa Socket.IO (evento 'Evento-Mensaje-Server'),
 * así que se prueba con socket.io-client. Supertest se usa para las rutas HTTP.
 */
const request = require('supertest');
const { io: Client } = require('socket.io-client');
const validation = require('../../libs/unalib');
const { app, http, io } = require('../../server');

let baseUrl;
let cliente;
let spy;

// Envía un mensaje por el evento real y espera la respuesta del servidor.
function enviar(mensaje) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sin respuesta del servidor')), 3000);
    cliente.once('Evento-Mensaje-Server', (resp) => {
      clearTimeout(timer);
      resolve(JSON.parse(resp));
    });
    cliente.emit('Evento-Mensaje-Server', JSON.stringify({
      nombre: 'Krys', mensaje, color: '#1A2B3C'
    }));
  });
}

beforeAll((done) => {
  http.listen(0, () => {
    baseUrl = `http://localhost:${http.address().port}`;
    cliente = Client(baseUrl, { transports: ['websocket'], forceNew: true });
    cliente.on('connect', done);
  });
});

beforeEach(() => {
  spy = jest.spyOn(validation, 'validarMensaje');
});

afterEach(() => {
  spy.mockRestore();
});

afterAll((done) => {
  cliente.disconnect();
  io.close();          // cierra Socket.IO y el servidor HTTP
  http.close(() => done());
});

describe('Rutas HTTP (Supertest)', () => {
  test('GET / sirve el frontend del chat', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('id="messages"');
  });

  test('GET /media/una.png sirve la imagen de prueba', async () => {
    const res = await request(app).get('/media/una.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
  });
});

describe('Evento Socket.IO Evento-Mensaje-Server + una-lib', () => {
  test('URL de imagen valida: el backend acepta el mensaje', async () => {
    const url = 'https://example.com/foto.jpg';
    const resp = await enviar(url);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(spy.mock.calls[0][0]).mensaje).toBe(url);
    expect(resp.tipo).toBe('imagen');
    expect(resp.mensaje).toMatch(/^<img /);
    expect(resp.nombre).toBe('Krys');
    expect(resp.color).toBe('#1A2B3C');
  });

  test('URL de video valida (YouTube): el backend acepta el mensaje', async () => {
    const resp = await enviar('https://www.youtube.com/watch?v=qYwlqx-JLok');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(resp.tipo).toBe('video');
    expect(resp.mensaje).toContain('<iframe');
    expect(resp.mensaje).toContain('embed/qYwlqx-JLok');
  });

  test('URL de video valida (webm): el backend acepta el mensaje', async () => {
    const resp = await enviar('http://localhost:3000/media/una.webm');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(resp.tipo).toBe('video');
    expect(resp.mensaje).toMatch(/^<video [^>]*controls/);
  });

  test('Script: la validacion rechaza y sanea la entrada', async () => {
    const resp = await enviar("<script>alert('Inyección de script');</script>");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(resp.tipo).toBe('bloqueado');
    expect(resp.mensaje).not.toMatch(/<script/i);
    expect(resp.mensaje).toContain('&lt;script&gt;');
  });

  test('URL no permitida: se trata como texto escapado, sin etiquetas', async () => {
    const resp = await enviar('https://example.com/malware.exe');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(resp.tipo).toBe('texto');
    expect(resp.mensaje).not.toContain('<');
  });

  test('Imagen con onerror inyectado: se bloquea', async () => {
    const resp = await enviar('<img src=x onerror=alert(1)>');

    expect(resp.tipo).toBe('bloqueado');
    expect(resp.mensaje).not.toContain('<img');
  });
});
