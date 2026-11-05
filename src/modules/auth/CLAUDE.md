# Módulo Auth — Registro, Login y Middleware JWT

## Estructura
```
src/modules/auth/
├── auth.routes.ts      — POST /auth/register, POST /auth/login
├── auth.service.ts     — lógica de registro y login
├── auth.repository.ts  — queries: findByEmail, create
├── auth.middleware.ts  — verificación JWT, adjunta req.user
└── auth.types.ts       — AuthPayload, RegisterBody, LoginBody

tests/
├── auth.test.ts             — tests de integración de los endpoints
├── auth.service.test.ts     — tests del service
└── auth.middleware.test.ts  — tests del middleware JWT
```

## Reglas del módulo
- Hash de contraseña: bcryptjs con salt rounds = 10
- IMPORTANT: Nunca retornar password_hash al cliente. Excluir el campo en toda query SELECT que alimente una respuesta HTTP
- Tokens JWT: firmar con variable de entorno JWT_SECRET. Expiración: 24h
- El middleware auth DEBE adjuntar `{ id, email }` en `req.user` tras verificar el token
- Si el token es inválido o falta, responder 401 con `{ error: "Unauthorized" }`

## Endpoints
| Método | Ruta             | Auth | Descripción          |
|--------|------------------|------|----------------------|
| POST   | /auth/register   | No   | Crear cuenta nueva   |
| POST   | /auth/login      | No   | Obtener JWT          |

## Validaciones requeridas
- register: email válido, password ≥ 8 caracteres, name no vacío
- login: email y password obligatorios
- Responder 409 si el email ya existe al registrar

## Tests obligatorios
- Registro exitoso → 201 + token
- Registro con email duplicado → 409
- Login exitoso → 200 + token válido
- Login con credenciales incorrectas → 401
- Acceso a ruta protegida sin token → 401
- Acceso con token expirado → 401
