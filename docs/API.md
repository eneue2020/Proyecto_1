# API de Snap

Snap es un acortador de URLs con analíticas. Todas las peticiones y respuestas usan JSON.

- **URL base (desarrollo):** `http://localhost:3000`
- **Autenticación:** las rutas marcadas con 🔒 requieren la cabecera `Authorization: Bearer <token>`. El token se obtiene con [`/auth/register`](#post-authregister) o [`/auth/login`](#post-authlogin) y caduca a las 24 h.
- **Fechas:** siempre en ISO 8601 UTC, por ejemplo `2026-10-31T09:12:44.120Z`.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET` | [`/health`](#get-health) | — | Estado del servicio |
| `POST` | [`/auth/register`](#post-authregister) | — | Crear una cuenta |
| `POST` | [`/auth/login`](#post-authlogin) | — | Iniciar sesión |
| `POST` | [`/urls`](#post-urls) | 🔒 | Acortar una URL |
| `GET` | [`/urls`](#get-urls) | — | Listar todas las URLs |
| `DELETE` | [`/urls/:code`](#delete-urlscode) | 🔒 | Borrar una URL propia |
| `GET` | [`/dashboard`](#get-dashboard) | 🔒 | Resumen y tendencias de las URLs propias |
| `GET` | [`/:code`](#get-code) | — | Redirigir a la URL original y registrar el click |

## Errores

Todos los errores tienen el mismo formato:

```json
{ "error": { "code": "URL_NOT_FOUND", "message": "Código no encontrado: Zz9Zz9Z" } }
```

`code` es estable y está pensado para usarse en el código del cliente. `message` es un texto para personas y puede cambiar.

Códigos comunes a todas las rutas:

| Estado | `code` | Cuándo |
|---|---|---|
| 400 | `INVALID_JSON` | El body no es JSON válido |
| 401 | `MISSING_TOKEN` | Ruta 🔒 sin cabecera `Authorization` |
| 401 | `INVALID_TOKEN` | Token mal formado o con firma incorrecta |
| 401 | `TOKEN_EXPIRED` | Token caducado |
| 404 | `NOT_FOUND` | La ruta no existe |
| 500 | `INTERNAL_ERROR` | Error inesperado del servidor |

Los 401 de rutas 🔒 incluyen la cabecera `WWW-Authenticate: Bearer`.

---

## `GET /health`

Comprueba que el servicio está levantado.

**`200 OK`**

```json
{ "status": "ok", "uptime": 123.45 }
```

`uptime` son los segundos desde que arrancó el proceso.

---

## `POST /auth/register`

Crea una cuenta y devuelve un token.

**Body**

| Campo | Tipo | Reglas |
|---|---|---|
| `email` | string | Email válido. Se guarda en minúsculas y sin espacios |
| `password` | string | Mínimo 8 caracteres y máximo 72 bytes |
| `name` | string | No vacío. Se recortan los espacios |

**`201 Created`**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs…",
  "user": { "id": 5, "email": "ana@example.com", "name": "Ana", "createdAt": "2026-10-30T01:19:41.321Z" }
}
```

**Errores:** `400 INVALID_INPUT` (falta un campo o no es texto), `400 INVALID_EMAIL`, `400 PASSWORD_TOO_SHORT`, `400 PASSWORD_TOO_LONG`, `400 INVALID_NAME`, `409 EMAIL_ALREADY_EXISTS`.

---

## `POST /auth/login`

**Body:** `email` y `password` (strings).

**`200 OK`:** el mismo formato que en el registro.

**Errores:**
- `400 INVALID_INPUT`.
- `401 INVALID_CREDENTIALS`: se devuelve tanto si el email no existe como si el password es incorrecto, para no revelar qué emails están registrados.

---

## `POST /urls` 🔒

Acorta una URL. La URL queda asociada al usuario autenticado.

**Body**

```json
{ "url": "https://example.com/un/camino/muy/largo?x=1" }
```

Solo se aceptan `http` y `https`, con un máximo de 2048 caracteres. La URL se normaliza, por ejemplo `https://example.com` pasa a ser `https://example.com/`.

**`201 Created`**

```json
{
  "code": "2JVF4QC",
  "originalUrl": "https://example.com/un/camino/muy/largo?x=1",
  "createdAt": "2026-10-30T00:57:33.054Z",
  "userId": 5,
  "shortUrl": "http://localhost:3000/2JVF4QC"
}
```

El código tiene 7 caracteres alfanuméricos. Acortar la misma URL dos veces genera dos códigos distintos.

**Errores:** `400 INVALID_URL`, `500 CODE_GENERATION_FAILED` (no se encontró un código libre; es extremadamente improbable).

---

## `GET /urls`

Lista **todas** las URLs, de la más reciente a la más antigua. No requiere autenticación.

**`200 OK`:** un array con objetos del mismo formato que en `POST /urls`. `userId` es `null` en las URLs creadas antes de que existiera la autenticación.

---

## `DELETE /urls/:code` 🔒

Borra una URL del usuario autenticado. Sus clicks se borran con ella.

**`204 No Content`**, sin body.

**Errores:**
- `403 FORBIDDEN`: la URL es de otro usuario o no tiene dueño.
- `404 URL_NOT_FOUND`.

---

## `GET /dashboard` 🔒

Resumen del rendimiento de las URLs del usuario autenticado: totales históricos, tendencia en un periodo comparada con el periodo anterior, y estadísticas por URL. Solo incluye las URLs del propio usuario.

### Parámetros de query

| Parámetro | Valores | Por defecto | Descripción |
|---|---|---|---|
| `days` | `7`, `30`, `90` | `30` | Duración del periodo en días, contando hoy |

### Cómo se calcula el periodo

Los días son días **UTC**. Con `days=7` consultado el 31-10-2026 a cualquier hora:

- **Periodo actual:** del 25-10 al 31-10, ambos incluidos.
- **Periodo anterior**, para la comparación: los 7 días previos, del 18-10 al 24-10.

### `200 OK`

```json
{
  "period": { "days": 7, "from": "2026-10-25", "to": "2026-10-31", "timezone": "UTC" },
  "totals": {
    "urls": 3,
    "clicks": 8,
    "lastClickAt": "2026-10-31T09:00:00.000Z"
  },
  "trend": {
    "current": 4,
    "previous": 2,
    "changePercent": 100,
    "currentUniqueVisitors": 2,
    "daily": [
      { "date": "2026-10-25", "clicks": 1 },
      { "date": "2026-10-26", "clicks": 0 },
      { "date": "2026-10-27", "clicks": 0 },
      { "date": "2026-10-28", "clicks": 0 },
      { "date": "2026-10-29", "clicks": 1 },
      { "date": "2026-10-30", "clicks": 0 },
      { "date": "2026-10-31", "clicks": 2 }
    ]
  },
  "urls": [
    {
      "code": "2JVF4QC",
      "originalUrl": "https://a.com/",
      "createdAt": "2026-10-20T08:00:00.000Z",
      "totalClicks": 5,
      "periodClicks": 3,
      "lastClickAt": "2026-10-31T09:00:00.000Z",
      "shortUrl": "http://localhost:3000/2JVF4QC"
    }
  ]
}
```

| Campo | Descripción |
|---|---|
| `period.from`, `period.to` | Primer y último día del periodo, ambos incluidos (`YYYY-MM-DD`) |
| `totals.urls` | Número total de URLs del usuario, aunque `urls` venga recortada |
| `totals.clicks` | Clicks históricos de todas sus URLs |
| `totals.lastClickAt` | Último click en cualquiera de sus URLs. `null` si no hay ninguno |
| `trend.current` / `trend.previous` | Clicks en el periodo actual y en el anterior |
| `trend.changePercent` | Variación porcentual respecto al periodo anterior, con 1 decimal (puede ser negativa). `null` si el periodo anterior tuvo 0 clicks |
| `trend.currentUniqueVisitors` | Visitantes distintos en el periodo actual, según la IP anonimizada (ver [qué se registra](#qué-se-registra-en-cada-click)) |
| `trend.daily` | Exactamente `days` elementos en orden ascendente. Los días sin clicks aparecen con `0` |
| `urls` | Como máximo **50** URLs, ordenadas por `periodClicks` descendente y, a igualdad, de la más reciente a la más antigua |
| `urls[].totalClicks` | Clicks históricos de la URL |
| `urls[].periodClicks` | Clicks de la URL en el periodo actual |
| `urls[].lastClickAt` | Último click de la URL. `null` si nunca recibió uno |

Un usuario sin URLs recibe un `200` con todos los contadores a `0`, `changePercent: null`, `lastClickAt: null`, `daily` lleno de ceros y `urls: []`.

### Errores

| Estado | `code` | Cuándo |
|---|---|---|
| 400 | `INVALID_PERIOD` | `days` no es 7, 30 ni 90. Incluye valores no numéricos, vacíos o repetidos (`?days=7&days=30`) |
| 401 | `MISSING_TOKEN` / `INVALID_TOKEN` / `TOKEN_EXPIRED` | Sin autenticación válida. Se comprueba antes que `days` |

### Ejemplo

```bash
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/dashboard?days=7"
```

---

## `GET /:code`

Redirige a la URL original con **`302 Found`** y la cabecera `Location`. Se usa 302 y no 301 para que el navegador no guarde la redirección en caché y cada visita pase por el servidor y se registre.

- **Código inexistente:** `404 URL_NOT_FOUND`.
- **Rutas que no tienen forma de código**, como `/favicon.ico`: `404 NOT_FOUND`.

### Qué se registra en cada click

Cada `GET` que redirige guarda un click con:

| Dato | Detalle |
|---|---|
| Fecha y hora | En UTC |
| `Referer` | Recortado a 512 caracteres |
| `User-Agent` | Recortado a 256 caracteres |
| IP anonimizada | HMAC-SHA256 con `CLICK_HASH_SECRET` (o `JWT_SECRET` si no está definido), truncado a 22 caracteres. **La IP nunca se guarda en claro.** Sirve para contar visitantes únicos |

Además:

- **Las peticiones `HEAD` redirigen pero no cuentan como click.** Suelen ser comprobadores de enlaces y previsualizaciones.
- **Si registrar el click falla, la redirección se hace igualmente.** El error queda en el log del servidor.
- **Cambiar `CLICK_HASH_SECRET` cambia todos los hashes.** Los visitantes de antes y de después del cambio cuentan como distintos.
- **Bots:** en esta versión no se filtran y cuentan como clicks normales.
- **IPs y proxies:** las IPs se toman de `req.ip`. Si el servidor está detrás de un proxy, hay que configurar `trust proxy` en Express para obtener la IP real del visitante.
