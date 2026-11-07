# Laboratorio 8 — Client Secret de Auth0 en Supabase Vault

Guía paso a paso para este repositorio. **Nunca** pongas en Git, logs ni capturas: el Client Secret,
la contraseña de `una_chat_backend` ni la `VAULT_DATABASE_URL` completa.

## Qué agrega el código

| Archivo | Qué hace |
|---|---|
| `server/vault.js` | Se conecta como `una_chat_backend` con TLS verificado (CA + nombre del host) y ejecuta `una_chat_private.get_auth0_client_secret()`. Lo hace una vez al arrancar; el secreto queda solo en memoria. |
| `server/auth.js` | Login con Auth0: Authorization Code + PKCE, `client_secret_post`. Rutas `/auth/config`, `/auth/login`, `/auth/callback`, `/auth/logout`, `/auth/me`. Protege `/sala` (401) y Socket.IO. |
| `server/supabase-root-2021-ca.pem` | **Lo agregás vos** (paso 0). Certificado raíz público de Supabase. |
| `sql/una_chat_vault_access.sql`, `sql/check_vault_privileges.sql` | Scripts del laboratorio. |
| `tests/integration/auth.test.js` | Pruebas de las rutas nuevas (sin red). |

Al arrancar con login activo, el log muestra:
```
[auth] Client Secret leído desde Supabase Vault (una_chat_backend...@host:5432/postgres, longitud 64)
[auth] prueba de arranque: HTTP 400 invalid_grant (esperado: Auth0 aceptó el secreto)
```
Si sale `invalid_client`, Vault tiene un secreto que no es el de esa aplicación.

## 0. Certificado de Supabase
Supabase → **Database → Settings → SSL Configuration → Download certificate**. Guardalo como
`server/supabase-root-2021-ca.pem` y commitealo (es público, no es un secreto).

## 1. Vault
Integrations → Vault → nuevo secreto `una_chat_auth0_client_secret` con el Client Secret de Auth0.
📸 Fila con el nombre y el valor oculto.

## 2. Rol y permisos (SQL Editor)
1. `create role una_chat_backend login password '...';` (contraseña larga; borrá el editor).
2. Ejecutá completo `sql/una_chat_vault_access.sql` → Success.
3. Ejecutá `sql/check_vault_privileges.sql` → solo `backend_execute = true`. 📸
4. Bloqueo (cada uno debe dar **42501**; `reset role;` entre pruebas):
   ```sql
   set role anon;          select una_chat_private.get_auth0_client_secret();
   reset role;
   set role authenticated; select una_chat_private.get_auth0_client_secret();
   reset role;
   set role anon;          select name from vault.decrypted_secrets;
   reset role;
   ```

## 3. Lectura del servidor
```sql
grant una_chat_backend to current_user;
set role una_chat_backend;
select length(una_chat_private.get_auth0_client_secret()) as secret_length;  -- > 16
reset role;
revoke una_chat_backend from current_user;
select pg_has_role(current_user, 'una_chat_backend', 'member') as dashboard_is_member; -- false
```
📸 `secret_length` y `dashboard_is_member = false`.

## 4. Auth0
- Application Type: **Regular Web Application**. Credentials: **Client Secret (Post)**. 📸
- Allowed Callback URLs:
  ```
  http://localhost:3000/auth/callback, http://127.0.0.1:3000/auth/callback, https://TU-SERVICIO.onrender.com/auth/callback
  ```
- Allowed Logout URLs y Allowed Web Origins:
  ```
  http://localhost:3000, http://127.0.0.1:3000, https://TU-SERVICIO.onrender.com
  ```

## 5. Local
```bash
cp .env.example .env      # completar AUTH0_DOMAIN (sin https://), AUTH0_CLIENT_ID, VAULT_DATABASE_URL
npm install
node server.js
```
`VAULT_DATABASE_URL` (Supabase → Connect). Si tu red no tiene IPv6, usá el session pooler (usuario con `.PROJECT_REF`):
```
postgresql://una_chat_backend.PROJECT_REF:PASSWORD@aws-REGION.pooler.supabase.com:5432/postgres?sslmode=verify-full
```
Si la contraseña tiene `@ / # :` codificala: `node -e "console.log(encodeURIComponent(process.argv[1]))" 'tu-clave'`.

## 6. Render
Environment: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `VAULT_DATABASE_URL`, `APP_BASE_URL=https://TU-SERVICIO.onrender.com`
(sin barra final). Si existe `AUTH0_CLIENT_SECRET`, dejala hasta el primer login. 📸 nombres con valores enmascarados.

Merge a `main` → GitHub Actions (CI/CD) → Deploy → **Live**. 📸 commit desplegado.

Sin cookie (ventana privada o curl):
```bash
curl -i https://TU-SERVICIO.onrender.com/auth/config   # 200, enabled true, dominio y clientId
curl -i https://TU-SERVICIO.onrender.com/sala          # 401
curl -i https://TU-SERVICIO.onrender.com/auth/login    # 302 → https://TU_DOMINIO/authorize...
```
Ventana privada → login → sala con tu nombre y **Cerrar sesión**. 📸 (tapá el correo)

## 7. Quitar la variable vieja
Render → Environment → Edit → borrar `AUTH0_CLIENT_SECRET` → **Save and deploy** → Live. 📸 lista final y
deploy "Environment updated". Recargá el chat: seguís en la sala. `curl -i .../sala` sin cookie → 401.

## 8. Rotación
1. Guardá en privado el secreto **anterior**. Auth0 → Credentials → **Rotate secret**; copiá el **nuevo**.
2. SQL Editor:
   ```sql
   select id from vault.secrets where name = 'una_chat_auth0_client_secret';
   select vault.update_secret('UUID'::uuid, 'SECRETO-NUEVO');   -- Success y borrar el editor (sin captura)
   ```
3. Redeploy (Actions → Run workflow, o Render → Manual Deploy). Live → ventana privada nueva → login → sala.
   (Las sesiones viejas quedan invalidadas: la cookie se firma con una llave derivada del secreto.)
4. Comparar secretos (no los dejes en el historial de la terminal; podés leerlos con `read -s`):
   ```bash
   read -s VIEJO; read -s NUEVO
   probar() { date '+%H:%M:%S'; curl -s -w '\nHTTP %{http_code}\n' -X POST "https://TU_DOMINIO/oauth/token" \
     -H 'content-type: application/x-www-form-urlencoded' \
     --data-urlencode grant_type=authorization_code \
     --data-urlencode client_id=TU_CLIENT_ID \
     --data-urlencode "client_secret=$1" \
     --data-urlencode code=vault-startup-probe \
     --data-urlencode redirect_uri=https://TU-SERVICIO.onrender.com/auth/callback \
     --data-urlencode code_verifier=$(head -c 48 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=') ; }
   probar "$VIEJO"   # esperado: invalid_client (Auth0 suele responder 401)
   probar "$NUEVO"   # esperado: invalid_grant (Auth0 suele responder 403)
   unset VIEJO NUEVO
   ```
   Anotá hora, estado HTTP y `error` de cada intento.

## Bitácora (plantilla)
| Hora | Etapa | Resultado | Evidencia |
|---|---|---|---|
| | Vault | Secreto `una_chat_auth0_client_secret` creado | captura 1 |
| | Permisos | Solo `backend_execute` true; anon y authenticated → 42501 | captura 2–3 |
| | Lectura | `secret_length` = __; `dashboard_is_member` = false | captura 4 |
| | Auth0 | Regular Web App, Client Secret (Post), 3 callbacks | captura 5–6 |
| | Render | Variables enmascaradas; deploy Live commit `____` | captura 7–8 |
| | Login | Sesión en ventana privada con nombre y Cerrar sesión | captura 9 |
| | Retiro | `AUTH0_CLIENT_SECRET` eliminado; Live; `/sala` sin cookie → 401 | captura 10 |
| | Rotación | Viejo: HTTP ___ `invalid_client`; nuevo: HTTP ___ `invalid_grant`; login nuevo OK | captura 11 |

## Si te quedás pegado
- **`[42501]` en el arranque**: corriste el script de permisos en otro proyecto.
- **`UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `SELF_SIGNED_CERT_IN_CHAIN`**: falta o está mal `server/supabase-root-2021-ca.pem`.
- **`ENETUNREACH` / `ENOTFOUND` con `db.*.supabase.co`**: tu red no tiene IPv6 → usá el session pooler.
- **`password authentication failed`**: con pooler el usuario es `una_chat_backend.PROJECT_REF`; revisá la codificación de la contraseña.
- **Callback URL mismatch**: `APP_BASE_URL` debe coincidir exactamente con un origen registrado (sin barra final).
- **Login falla tras rotar**: Vault tiene el valor viejo o no redesplegaste.
