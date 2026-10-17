// una-lib: validación de mensajes del chat UNA.
//
// Regla de seguridad: NADA que venga del usuario se inserta como HTML tal cual.
//  - El texto se escapa (<, >, &, ", ', `, /) para que el navegador lo muestre como texto.
//  - Solo se generan etiquetas <img>, <video> o <iframe> (YouTube) cuando la URL
//    pasa una validación estricta, y aun así la URL se escapa antes de insertarla.
//  - El nombre se escapa y el color solo se acepta si es un hexadecimal válido.

// Imagen: http(s), host válido, ruta sin espacios ni caracteres peligrosos,
// termina en extensión de imagen (se permite ?query o #hash al final).
var RE_IMAGE = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[\w\-.~%!$&()*+,;=:@]*)*\.(?:jpg|jpeg|png|gif|bmp|webp|svg)(?:\?[\w\-.~%!$&()*+,;=:@/?]*)?(?:#[\w\-]*)?$/i;

// Video directo: igual que la imagen, pero con extensiones de video.
var RE_VIDEO_FILE = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:\/[\w\-.~%!$&()*+,;=:@]*)*\.(?:mp4|webm|ogg|ogv)(?:\?[\w\-.~%!$&()*+,;=:@/?]*)?(?:#[\w\-]*)?$/i;

// YouTube: youtube.com/watch?v=ID, youtube.com/embed/ID, youtu.be/ID (ID de 11 caracteres).
var RE_YOUTUBE = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?(?:[\w=&-]*&)?v=))([\w-]{11})(?:[?&#][\w=&%.-]*)?$/i;

// Patrones típicos de inyección (para detectar y registrar el intento).
var RE_SCRIPT_INJECTION = /<\s*\/?\s*(script|iframe|object|embed|svg|img|video|audio|link|meta|style|base|form)\b|on\w+\s*=|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html/i;

var RE_HEX_COLOR = /^#[0-9a-f]{6}$/i;

var HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
  '/': '&#x2F;',
  '=': '&#x3D;'
};

function safeTest(re, value) {
  try {
    return typeof value === 'string' && re.test(value.trim());
  } catch (e) {
    console.log(e);
    return false;
  }
}

module.exports = {

  // lógica que valida si un teléfono está correcto...
  is_valid_phone: function (phone) {
    var re = /^[+]*[(]{0,1}[0-9]{1,4}[)]{0,1}[-\s\./0-9]*$/i;
    return safeTest(re, phone);
  },

  is_valid_url_image: function (url) {
    return safeTest(RE_IMAGE, url);
  },

  is_valid_yt_video: function (url) {
    return safeTest(RE_YOUTUBE, url);
  },

  is_valid_video_file: function (url) {
    return safeTest(RE_VIDEO_FILE, url);
  },

  is_valid_video: function (url) {
    return this.is_valid_yt_video(url) || this.is_valid_video_file(url);
  },

  has_script_injection: function (text) {
    return safeTest(RE_SCRIPT_INJECTION, text);
  },

  is_valid_color: function (color) {
    return safeTest(RE_HEX_COLOR, color);
  },

  // Convierte cualquier texto en texto plano seguro para insertar en HTML.
  escapeHtml: function (text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/[&<>"'`\/=]/g, function (c) {
      return HTML_ESCAPES[c];
    });
  },

  getYTVideoId: function (url) {
    var match = String(url).trim().match(RE_YOUTUBE);
    return match ? match[1] : null;
  },

  getEmbeddedCode: function (url) {
    var id = this.getYTVideoId(url);
    if (!id) return this.escapeHtml(url);
    return '<iframe class="chat-video" title="Video de YouTube" width="560" height="315" ' +
      'src="https://www.youtube-nocookie.com/embed/' + id + '" frameborder="0" ' +
      'allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" ' +
      'allowfullscreen></iframe>';
  },

  getVideoTag: function (url) {
    var safeUrl = this.escapeHtml(url.trim());
    return '<video class="chat-video" controls preload="metadata" aria-label="Video compartido" ' +
      'src="' + safeUrl + '" style="max-height: 400px;max-width: 400px;"></video>';
  },

  getImageTag: function (url) {
    var safeUrl = this.escapeHtml(url.trim());
    return '<img class="chat-image" alt="Imagen compartida" src="' + safeUrl + '" ' +
      'style="max-height: 400px;max-width: 400px;">';
  },

  // Valida y sanea un mensaje del chat.
  // Recibe el JSON (string) que envía el cliente y devuelve un JSON (string) seguro:
  //   { nombre, mensaje, color, tipo }  donde tipo = 'imagen' | 'video' | 'texto' | 'bloqueado'
  validarMensaje: function (msg) {
    var obj;
    try {
      obj = typeof msg === 'string' ? JSON.parse(msg) : msg;
    } catch (e) {
      obj = { mensaje: msg };
    }
    if (!obj || typeof obj !== 'object') {
      obj = { mensaje: '' };
    }

    var mensaje = typeof obj.mensaje === 'string' ? obj.mensaje : '';
    var nombre = typeof obj.nombre === 'string' && obj.nombre.trim() ? obj.nombre.slice(0, 50) : 'Anónimo';
    var color = this.is_valid_color(obj.color) ? obj.color : '#000000';
    var tipo;

    if (this.is_valid_url_image(mensaje)) {
      tipo = 'imagen';
      mensaje = this.getImageTag(mensaje);
    } else if (this.is_valid_yt_video(mensaje)) {
      tipo = 'video';
      mensaje = this.getEmbeddedCode(mensaje);
    } else if (this.is_valid_video_file(mensaje)) {
      tipo = 'video';
      mensaje = this.getVideoTag(mensaje);
    } else if (this.has_script_injection(mensaje)) {
      tipo = 'bloqueado';
      console.log('Intento de inyección bloqueado:', mensaje);
      mensaje = '[mensaje bloqueado: contenido no permitido] ' + this.escapeHtml(mensaje);
    } else {
      tipo = 'texto';
      mensaje = this.escapeHtml(mensaje);
    }

    return JSON.stringify({
      nombre: this.escapeHtml(nombre),
      mensaje: mensaje,
      color: color,
      tipo: tipo
    });
  }
};

// Alias con el nombre original en inglés (compatibilidad).
module.exports.validateMessage = module.exports.validarMensaje;
