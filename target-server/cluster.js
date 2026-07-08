/**
 * S.A.F. — Target Server: Cluster Master
 *
 * Este es el punto de entrada del servidor en producción (`npm start`).
 *
 * Patrón de arquitectura: Master/Worker con Node.js cluster nativo.
 *
 * ¿Por qué cluster en lugar de pm2?
 *   pm2 introduce un proceso daemon externo que complica el debugging,
 *   el graceful shutdown coordinado y la visibilidad de logs en desarrollo.
 *   El módulo `cluster` nativo nos da control total sobre:
 *     - Cuántos workers forkeamos (= núcleos disponibles)
 *     - Qué pasa cuando un worker muere (auto-restart con backoff)
 *     - La comunicación Master ↔ Worker vía IPC
 *     - El shutdown coordinado de TODOS los workers al recibir SIGTERM
 *
 * Flujo:
 *   Master proceso (este archivo) → fork N workers (server.js)
 *   Cada worker escucha en el MISMO puerto (el kernel balancea las conexiones)
 *   Si un worker muere, el Master lo reinicia automáticamente
 *   Al recibir SIGTERM, el Master envía shutdown a todos los workers
 *   y espera a que todos terminen antes de cerrar
 */

'use strict';

require('dotenv').config();

const cluster = require('cluster');
const os      = require('os');
const logger  = require('./src/logger');

// Número de workers = número de núcleos lógicos disponibles.
// En producción esto maximiza el throughput. En desarrollo con 2-4 cores
// obtendremos 2-4 workers, lo cual ya es suficiente para simular concurrencia real.
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT ?? os.cpus().length, 10);

// Tiempo mínimo entre reinicios de un worker (evita restart loops por crash rápido)
const RESTART_DELAY_MS = 1000;

if (cluster.isPrimary) {
  logger.info(
    { workerCount: WORKER_COUNT, nodeVersion: process.version },
    `S.A.F. Target Server — Iniciando cluster`
  );

  // ── Forkeamos un worker por núcleo ────────────────────────────────────────
  for (let i = 0; i < WORKER_COUNT; i++) {
    forkWorker(i + 1);
  }

  // ── Auto-restart de workers caídos ────────────────────────────────────────
  cluster.on('exit', (worker, code, signal) => {
    const workerId = worker.process.env?.WORKER_ID ?? worker.id;

    if (worker.exitedAfterDisconnect) {
      // Salida limpia iniciada por el Master (parte del graceful shutdown)
      logger.info({ workerId, code }, `Worker terminó limpiamente`);
      return;
    }

    // Salida inesperada — reiniciamos con un pequeño delay para evitar
    // un restart loop si el worker crashea al arrancar (ej. puerto ocupado)
    logger.warn({ workerId, code, signal }, `Worker caído inesperadamente — reiniciando en ${RESTART_DELAY_MS}ms`);
    setTimeout(() => forkWorker(workerId), RESTART_DELAY_MS);
  });

  // ── Graceful Shutdown del cluster completo ────────────────────────────────
  function shutdownCluster(signal) {
    logger.info({ signal }, `Master recibió señal — iniciando shutdown de todos los workers`);

    // Desconectamos todos los workers (les envía SIGTERM internamente)
    for (const worker of Object.values(cluster.workers)) {
      worker.disconnect();
    }

    // Esperamos a que todos los workers mueran (tienen su propio graceful shutdown)
    // Si en 15s no terminaron, forzamos
    const forceKillTimer = setTimeout(() => {
      logger.warn(`Timeout de cluster shutdown — forzando cierre de workers restantes`);
      for (const worker of Object.values(cluster.workers)) {
        worker.kill();
      }
      process.exit(0);
    }, 15_000);

    // .unref() para que el timer no mantenga vivo el master si los workers terminan antes
    forceKillTimer.unref();
  }

  process.on('SIGTERM', () => shutdownCluster('SIGTERM'));
  process.on('SIGINT',  () => shutdownCluster('SIGINT'));

} else {
  // Proceso worker — carga el servidor Express
  require('./server.js');
}

/**
 * Crea un nuevo worker con su ID inyectado como variable de entorno.
 * El WORKER_ID aparece en todos los logs y en el payload de telemetría,
 * permitiendo correlacionar métricas por worker en InfluxDB.
 *
 * @param {number} workerId
 */
function forkWorker(workerId) {
  const worker = cluster.fork({ WORKER_ID: String(workerId) });
  logger.info({ workerId, pid: worker.process.pid }, `Worker forkeado`);
  return worker;
}