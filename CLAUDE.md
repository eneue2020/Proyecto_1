# Snap — URL shortener con analytics

## Comandos
- Dev: `npm run dev` (tsx watch sobre src/server.ts, puerto `PORT` o 3000, carga `.env` si existe)
- Build: `npm run build` (tsc)
- Start: `npm start` (ejecuta dist/server.js)
- Test: `npm test` (vitest run)
- Test watch: `npm run test:watch`
- Test módulo: `npm test -- tests/urls`

## Variables de entorno
- `JWT_SECRET` (obligatoria; sin ella el server no arranca)
- `PORT`, `DATABASE_PATH` (por defecto snap.db), `CLICK_HASH_SECRET` (por defecto usa JWT_SECRET)

## Stack
- Runtime: Node.js 24.21.0 + TypeScript strict (ESM)
- Framework: Express 4
- Base de datos: SQLite con better-sqlite3 (archivo: snap.db)
- Auth: bcryptjs (hash) + jsonwebtoken (JWT)
- Tests: vitest + supertest

## Arquitectura
- Sin ORM: queries SQL directas con funciones helper tipadas
- Capas obligatorias: handler → service → repository. NUNCA saltar capas
- Cada capa es una factory con dependencias inyectadas: `createXRepository(db)` → `createXService(repo, opts)` → `createXRouter(service, requireAuth)`
- Los módulos se cablean y montan en `createApp()` de src/app.ts; el router de redirección `/:code` va siempre al final

## Estructura del proyecto
```
src/
├── server.ts             — entry point: lee env, crea la BD, llama a createApp y escucha
├── app.ts                — createApp(deps): cablea módulos, monta routers y middleware global
├── db/
│   ├── connection.ts     — createDatabase(): abre SQLite (WAL, foreign_keys) e inicializa el esquema
│   └── schema.ts         — initSchema(): CREATE TABLE/INDEX IF NOT EXISTS + addColumnIfMissing
├── modules/
│   ├── auth/             — registro, login, middleware JWT (ver su CLAUDE.md)
│   ├── urls/             — CRUD de URLs cortas + router de redirección /:code
│   ├── analytics/        — registro de clicks (sin router propio, lo usa la redirección)
│   ├── dashboard/        — GET /dashboard con analytics de clicks
│   ├── health/           — GET /health
│   └── web/              — sirve la interfaz estática de public/ en /app
└── shared/               — error-handler.ts (404 + errores), http-error.ts
public/                   — frontend estático (HTML, CSS, JS)
tests/                    — tests de vitest + supertest, un archivo por módulo/tema
```
- Cada módulo sigue el patrón `<modulo>.routes.ts`, `.service.ts`, `.repository.ts`, `.types.ts`

## Esquema de base de datos
- users(id, email UNIQUE NOCASE, password_hash, name, created_at)
- urls(id, code UNIQUE, original_url, created_at, user_id → users, click_count, last_click_at)
- clicks(id, url_id → urls, clicked_at, referrer, user_agent, ip_hash)
- Índices: idx_urls_user_id, idx_clicks_url_time_ip (url_id, clicked_at, ip_hash)
- `click_count` y `last_click_at` son contadores desnormalizados que lee el dashboard

## Reglas de código
- SIEMPRE TypeScript strict, NUNCA usar `any` (usar `unknown` si es necesario)
- SIEMPRE import/export ESM, NUNCA require/module.exports
- Nombres de variables y funciones: camelCase
- Nombres de archivos: kebab-case
- Funciones async siempre con try/catch y errores tipados
- Cada endpoint DEBE tener al menos 1 test de integración con supertest

## Auth
- Las contraseñas se hashean con bcryptjs antes de almacenar
- IMPORTANT: Nunca loguear ni retornar password_hash en ninguna respuesta
- Los tokens JWT se envían en header `Authorization: Bearer <token>`
- El middleware de auth decodifica el token y adjunta `req.user` con { id, email }

## Base de datos
- No hay archivos de migración: el esquema se aplica al arrancar con `initSchema()` en src/db/schema.ts y debe ser idempotente
- IMPORTANT: Las bases existentes no se recrean. Nunca cambiar ni quitar columnas de un CREATE TABLE existente; las columnas nuevas se añaden al CREATE TABLE y además con `addColumnIfMissing()`
- Índices nuevos con `CREATE INDEX IF NOT EXISTS`
- No hay seeds; los tests crean su propia BD

## Git
- Branch principal: main
- Ramas con prefijo según el tipo de cambio (alineado con Conventional Commits):
  - `feat/nombre-corto`: funcionalidad nueva
  - `fix/nombre-corto`: corrección de bugs
  - `docs/nombre-corto`: solo documentación
  - `chore/nombre-corto`: mantenimiento, dependencias, configuración
- NUNCA commitear directamente a main

