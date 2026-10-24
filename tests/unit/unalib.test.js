// Pruebas unitarias de una-lib (lógica de validación).
var val = require('../../libs/unalib');
var assert = require('assert');

function procesar(mensaje) {
  return JSON.parse(val.validarMensaje(JSON.stringify({
    nombre: 'Krys', mensaje: mensaje, color: '#123ABC'
  })));
}

describe('unalib', function () {

  // ---------- pruebas originales del proyecto ----------
  describe('funcion is_valid_phone', function () {
    it('deberia devolver true para 8297-8547', function () {
      assert.equal(val.is_valid_phone('8297-8547'), false);
    });
    it('deberia devolver false para 8297p-8547', function () {
      assert.equal(val.is_valid_phone('8297p-8547'), false);
    });
  });

  // ---------- validación de URLs de imágenes ----------
  describe('validacion de URLs de imagenes', function () {
    it('acepta http://image.com/image.jpg', function () {
      assert.equal(val.is_valid_url_image('http://image.com/image.jpg'), true);
    });
    it('acepta http://image.com/image.gif', function () {
      assert.equal(val.is_valid_url_image('http://image.com/image.gif'), true);
    });
    it('acepta https con png, webp y query string', function () {
      assert.equal(val.is_valid_url_image('https://cdn.una.ac.cr/img/logo.png'), true);
      assert.equal(val.is_valid_url_image('https://example.com/a/b/foto.webp?w=400'), true);
    });
    it('rechaza URLs que no son imagenes', function () {
      assert.equal(val.is_valid_url_image('https://example.com/documento.pdf'), false);
      assert.equal(val.is_valid_url_image('hola mundo'), false);
    });
    it('rechaza protocolos peligrosos', function () {
      assert.equal(val.is_valid_url_image('javascript:alert(1)//x.png'), false);
      assert.equal(val.is_valid_url_image('data:image/png;base64,AAAA'), false);
    });
    it('rechaza una URL de imagen con atributos inyectados', function () {
      assert.equal(val.is_valid_url_image('http://x.com/a.png" onerror="alert(1)'), false);
      assert.equal(val.is_valid_url_image('http://x.com/a.png"><script>alert(1)</script>'), false);
    });
    it('validarMensaje convierte una imagen valida en etiqueta <img>', function () {
      var r = procesar('https://example.com/foto.jpg');
      assert.equal(r.tipo, 'imagen');
      assert.equal(r.mensaje.startsWith('<img '), true);
      assert.ok(r.mensaje.includes('src="https:&#x2F;&#x2F;example.com&#x2F;foto.jpg"'));
    });
  });

  // ---------- validación de URLs de videos ----------
  describe('validacion de URLs de videos', function () {
    it('acepta https://www.youtube.com/watch?v=qYwlqx-JLok', function () {
      assert.equal(val.is_valid_yt_video('https://www.youtube.com/watch?v=qYwlqx-JLok'), true);
    });
    it('acepta youtu.be y youtube.com/embed', function () {
      assert.equal(val.is_valid_yt_video('https://youtu.be/qYwlqx-JLok'), true);
      assert.equal(val.is_valid_yt_video('https://www.youtube.com/embed/qYwlqx-JLok'), true);
    });
    it('acepta archivos de video mp4, webm y ogg', function () {
      assert.equal(val.is_valid_video_file('https://example.com/video.mp4'), true);
      assert.equal(val.is_valid_video_file('http://localhost:3000/media/una.webm'), true);
      assert.equal(val.is_valid_video_file('https://example.com/clip.ogg'), true);
    });
    it('rechaza URLs de video malformadas', function () {
      assert.equal(val.is_valid_yt_video('https://www.youtube.com/watch?v=corto'), false);
      assert.equal(val.is_valid_yt_video('https://evil.com/watch?v=qYwlqx-JLok'), false);
      assert.equal(val.is_valid_video_file('https://example.com/video.exe'), false);
    });
    it('extrae el id de YouTube', function () {
      assert.equal(val.getYTVideoId('https://www.youtube.com/watch?v=qYwlqx-JLok'), 'qYwlqx-JLok');
    });
    it('validarMensaje integra un reproductor <iframe> para YouTube', function () {
      var r = procesar('https://www.youtube.com/watch?v=qYwlqx-JLok');
      assert.equal(r.tipo, 'video');
      assert.ok(r.mensaje.startsWith('<iframe '));
      assert.ok(r.mensaje.includes('youtube-nocookie.com/embed/qYwlqx-JLok'));
    });
    it('validarMensaje integra un reproductor <video controls> para mp4/webm', function () {
      var r = procesar('https://example.com/video.mp4');
      assert.equal(r.tipo, 'video');
      assert.ok(r.mensaje.startsWith('<video '));
      assert.ok(r.mensaje.includes('controls'));
    });
  });

  // ---------- prevención de inyección de scripts ----------
  describe('prevencion de inyeccion de scripts', function () {
    var ataques = [
      "<script>alert('Inyección de script');</script>",
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '<iframe src="javascript:alert(1)"></iframe>',
      '<a href="javascript:alert(1)">clic</a>',
      '<body onload=alert(1)>'
    ];

    ataques.forEach(function (ataque) {
      it('detecta y bloquea: ' + ataque, function () {
        assert.equal(val.has_script_injection(ataque), true);
        var r = procesar(ataque);
        assert.equal(r.tipo, 'bloqueado');
        assert.equal(r.mensaje.includes('<'), false, 'no debe quedar ningun "<" sin escapar');
        assert.equal(r.mensaje.includes('>'), false, 'no debe quedar ningun ">" sin escapar');
      });
    });

    it('el script del paso 2 queda escapado como texto', function () {
      var r = procesar("<script>alert('Inyección de script');</script>");
      assert.ok(r.mensaje.includes('&lt;script&gt;'));
    });

    it('escapa el nombre de usuario', function () {
      var r = JSON.parse(val.validarMensaje(JSON.stringify({
        nombre: '<script>alert(1)</script>', mensaje: 'hola', color: '#000000'
      })));
      assert.equal(r.nombre.includes('<'), false);
    });

    it('descarta colores que no son hexadecimales (inyeccion CSS/HTML)', function () {
      var r = JSON.parse(val.validarMensaje(JSON.stringify({
        nombre: 'x', mensaje: 'hola', color: "red'><script>alert(1)</script>"
      })));
      assert.equal(r.color, '#000000');
    });

    it('un texto normal pasa sin cambios', function () {
      var r = procesar('Hola, ¿cómo están?');
      assert.equal(r.tipo, 'texto');
      assert.equal(r.mensaje, 'Hola, ¿cómo están?');
    });

    it('JSON invalido no rompe el servidor y queda escapado', function () {
      var r = JSON.parse(val.validarMensaje('<script>alert(1)</script>'));
      assert.equal(r.mensaje.includes('<'), false);
    });
  });
});
