// npm install para descargar los paquetes...

// librerías
var path = require('path');
var express = require('express');
var validation = require('./libs/unalib');

var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var port = process.env.PORT || 3000;

// root: presentar html
app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// jQuery servido localmente (no depende de un CDN)
app.use('/vendor/jquery', express.static(path.join(__dirname, 'node_modules', 'jquery', 'dist')));

// medios de prueba locales (imagen y video estables para las pruebas E2E)
app.use('/media', express.static(path.join(__dirname, 'public', 'media')));

// escuchar una conexión por socket
io.on('connection', function (socket) {
  socket.on('Evento-Mensaje-Server', function (msg) {
    // toda entrada pasa por una-lib antes de reenviarse
    var seguro = validation.validarMensaje(msg);
    io.emit('Evento-Mensaje-Server', seguro);
  });
});

// Solo escucha el puerto si se ejecuta directamente (npm start).
// Las pruebas de integración importan app/http/io y abren su propio puerto.
if (require.main === module) {
  http.listen(port, function () {
    console.log('listening on *:' + port);
  });
}

module.exports = { app: app, http: http, io: io };
