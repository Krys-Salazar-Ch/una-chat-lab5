// Lee el Client Secret de Auth0 desde Supabase Vault.
//
// El servidor se conecta como el rol una_chat_backend, que solo puede ejecutar
// una_chat_private.get_auth0_client_secret(). No tiene acceso directo a
// vault.decrypted_secrets. El secreto se lee una vez al arrancar y queda solo
// en memoria: nunca se escribe en logs, respuestas ni archivos.

var fs = require('fs');
var path = require('path');
var net = require('net');

var CA_POR_DEFECTO = path.join(__dirname, 'supabase-root-2021-ca.pem');

// Quita los parámetros ssl* de la URI. node-postgres los interpreta por su
// cuenta y sobrescribiría la configuración TLS de abajo; aquí la verificación
// completa (certificado + nombre del host) se configura explícitamente.
function uriSinParametrosSsl(uri) {
  var url = new URL(uri);
  ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl', 'uselibpqcompat'].forEach(function (p) {
    url.searchParams.delete(p);
  });
  return url;
}

function leerCertificado(caPath) {
  var ruta = caPath || process.env.VAULT_CA_CERT_PATH || CA_POR_DEFECTO;
  try {
    return fs.readFileSync(ruta, 'utf8');
  } catch (e) {
    throw new Error(
      'No se encontró el certificado raíz de Supabase en ' + ruta +
      '. Descárgalo en Supabase → Database → Settings → SSL Configuration y guárdalo ahí.'
    );
  }
}

// Describe la conexión sin la contraseña (para logs).
function describirConexion(uri) {
  try {
    var url = new URL(uri);
    return url.username + '@' + url.hostname + ':' + (url.port || '5432') + url.pathname;
  } catch (e) {
    return 'URI inválida';
  }
}

async function leerClientSecret(opciones) {
  opciones = opciones || {};
  var uri = opciones.connectionString || process.env.VAULT_DATABASE_URL;
  if (!uri) throw new Error('VAULT_DATABASE_URL no está configurada');

  var url = uriSinParametrosSsl(uri);
  var { Client } = require('pg');
  var cliente = new Client({
    connectionString: url.toString(),
    ssl: {
      ca: leerCertificado(opciones.caPath),
      rejectUnauthorized: true, // equivalente a sslmode=verify-full
      servername: net.isIP(url.hostname) ? undefined : url.hostname,
    },
    application_name: 'una-chat',
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });

  try {
    await cliente.connect();
    var r = await cliente.query('select una_chat_private.get_auth0_client_secret() as secreto');
    var secreto = r.rows[0] && r.rows[0].secreto;
    if (typeof secreto !== 'string' || secreto.length === 0) {
      throw new Error('Vault devolvió un secreto vacío');
    }
    return secreto;
  } catch (err) {
    // Mensaje sin datos sensibles: solo código, rol y host.
    var e = new Error(
      'No se pudo leer el secreto de Vault (' + describirConexion(uri) + '): ' +
      (err.code ? '[' + err.code + '] ' : '') + err.message
    );
    e.code = err.code;
    throw e;
  } finally {
    await cliente.end().catch(function () {});
  }
}

module.exports = { leerClientSecret, describirConexion, uriSinParametrosSsl };
