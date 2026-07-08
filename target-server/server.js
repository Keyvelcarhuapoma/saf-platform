/**
 * S.A.F. — Target Server: Worker Process
 *
 * Este archivo es el proceso WORKER — se ejecuta dentro de cada fork
 * creado por cluster.js. No se ejecuta directamente en producción.
 *
 * Responsabilidades:
 *   1. Levantar el servidor Express con sus rutas
 *   2. Implementar Graceful Shutdown al recibir señales del OS o del Master
 *   3. Reportar su estado al proceso Master vía IPC
 */

'use strict';

require('dotenv').config();

const express  = require('express');
const http     = require('http');
const logger   = require('./src/logger');
const config   = require('./src/config');
const router   = require('./src/routes/status');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN DE EXPRESS
// ─────────────────────────────────────────────────────────────────────────────
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Eliminamos la cabecera X-Powered-By — no revelar el stack en producción
app.disable('x-powered-by');

// Montamos todas las rutas (status, health, reset)
app.use('/', router);

// Handler 404 genérico — cualquier ruta no definida
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

// Handler de errores global — captura cualquier excepción no manejada en middlewares
app.use((err, req, res, _next) => {
  logger.error({ err, path: req.path }, 'Error no controlado en middleware');
  res.status(500).json({ error: 'internal_server_error' });
});

// ─────────────────────────────────────────────────────────────────────────────
// SERVIDOR HTTP + GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────────────────
const server = http.createServer(app);

server.listen(config.server.port, () => {
  logger.info(
    { port: config.server.port, workerId: process.env.WORKER_ID ?? 'standalone' },
    `Worker escuchando`
  );
});

/**
 * Graceful Shutdown:
 *   Al recibir SIGTERM o SIGINT, el servidor deja de aceptar nuevas conexiones
 *   pero espera a que las conexiones activas terminen antes de cerrar.
 *   Esto evita cortar requests en vuelo — crítico para no contaminar
 *   el dataset de telemetría con errores artificiales de shutdown.
 *
 * @param {string} signal - Nombre de la señal recibida
 */
function gracefulShutdown(signal) {
  logger.info({ signal }, `Señal recibida — iniciando graceful shutdown`);

  // server.close() deja de aceptar nuevas conexiones
  server.close((err) => {
    if (err) {
      logger.error({ err }, `Error durante el cierre del servidor`);
      process.exit(1);
    }
    logger.info(`Servidor cerrado limpiamente — todas las conexiones completadas`);
    process.exit(0);
  });

  // Timeout de seguridad: si en 10s no cierra (conexiones colgadas), forzamos
  setTimeout(() => {
    logger.warn(`Timeout de graceful shutdown (10s) — forzando cierre`);
    process.exit(1);
  }, 10_000).unref(); // .unref() evita que este timer mantenga vivo el proceso
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// Capturamos excepciones no manejadas para logearlas antes de morir
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, `uncaughtException — el proceso debe reiniciarse`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, `unhandledRejection — promesa rechazada sin capturar`);
  process.exit(1);
});