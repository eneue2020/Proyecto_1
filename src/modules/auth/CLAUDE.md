# Módulo Auth — Registro, Login y Middleware JWT

## Estructura
```
src/modules/auth/
├── auth.routes.ts      — POST /auth/register, POST /auth/login; valida que los campos sean texto
├── auth.service.ts     — lógica de registro y login, validaciones, firma JWT; RegisterInput, LoginInput
├── auth.repository.ts  — queries: findByEmail, insert
├── auth.middleware.ts  — verificación JWT, adjunta req.user; getAuthUser(req)
└── auth.types.ts       — User, UserWithPassword, AuthResult, AuthenticatedUser, TokenPayload

tests/
├── auth.test.ts             — tests de integración de los endpoints
├── auth.service.test.ts     — tests del service
└── auth.middleware.test.ts  — tests del middleware JWT
```

## Reglas del módulo
- Hash de contraseña: bcryptjs con salt rounds = 10
- IMPORTANT: Nunca retornar password_hash al cliente. Excluir el campo en toda query SELECT que alimente una respuesta HTTP
- Tokens JWT: firmar con variable de entorno JWT_SECRET. Expiración: 24h. Payload `{ sub: String(id), email }`
- Verificar siempre con `algorithms: ['HS256']` fijo (evita `alg: none`)
- El middleware auth DEBE adjuntar `{ id, email }` en `req.user` tras verificar el token
- Los errores se lanzan como `HttpError(status, message, code)`; el errorHandler responde `{ error: { code, message } }`. NUNCA responder errores con otro formato
- Si el token falta o es inválido, responder 401 con header `WWW-Authenticate: Bearer`
- Login: mismo 401 `INVALID_CREDENTIALS` si el email no existe o el password es incorrecto, y comparar contra un hash de relleno para no revelar qué emails existen por tiempo de respuesta
- Emails normalizados con `normalizeEmail()` (trim + lowercase) antes de guardar o buscar; name con trim

## Endpoints
| Método | Ruta             | Auth | Descripción          |
|--------|------------------|------|----------------------|
| POST   | /auth/register   | No   | Crear cuenta nueva → 201 `{ token, user }` |
| POST   | /auth/login      | No   | Obtener JWT → 200 `{ token, user }`        |

`user` es `{ id, email, name, createdAt }`, nunca incluye `passwordHash`.

## Validaciones y códigos de error
| Caso | Status | `code` |
|------|--------|--------|
| Campo faltante o no string (email, password, name) | 400 | `INVALID_INPUT` |
| Email con formato inválido | 400 | `INVALID_EMAIL` |
| Password < 8 caracteres | 400 | `PASSWORD_TOO_SHORT` |
| Password > 72 bytes UTF-8 (límite de bcrypt) | 400 | `PASSWORD_TOO_LONG` |
| Name vacío tras trim | 400 | `INVALID_NAME` |
| Email ya registrado | 409 | `EMAIL_ALREADY_EXISTS` |
| Email o password incorrectos | 401 | `INVALID_CREDENTIALS` |
| Sin header `Authorization: Bearer` | 401 | `MISSING_TOKEN` |
| Token mal formado, firma o payload inválidos | 401 | `INVALID_TOKEN` |
| Token expirado | 401 | `TOKEN_EXPIRED` |

## Tests obligatorios
- Registro exitoso → 201 + token
- Registro con email duplicado → 409
- Login exitoso → 200 + token válido
- Login con credenciales incorrectas → 401
- Acceso a ruta protegida sin token → 401
- Acceso con token expirado → 401
- Acceso con token inválido → 401
