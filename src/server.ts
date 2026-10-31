import { createApp } from './app.js';
import { createDatabase } from './db/connection.js';

const port = Number(process.env.PORT ?? 3000);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  console.error('Falta la variable de entorno JWT_SECRET (ver .env.example)');
  process.exit(1);
}
const clickHashSecret = process.env.CLICK_HASH_SECRET;
const db = createDatabase(process.env.DATABASE_PATH ?? 'snap.db');

const server = createApp({
  db,
  jwtSecret,
  ...(clickHashSecret ? { clickHashSecret } : {}),
}).listen(port, () => {
  console.log(`Snap escuchando en http://localhost:${port}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`El puerto ${port} ya está en uso`);
  } else {
    console.error('Error al iniciar el servidor:', err);
  }
  process.exit(1);
});

function shutdown(signal: string): void {
  console.log(`${signal} recibido, cerrando servidor...`);
  server.close((err) => {
    db.close();
    if (err) {
      console.error('Error al cerrar el servidor:', err);
      process.exit(1);
    }
    process.exit(0);
  });
  // Si quedan conexiones abiertas, no esperar indefinidamente.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('Promesa rechazada sin manejar:', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Excepción no capturada:', err);
  process.exit(1);
});
