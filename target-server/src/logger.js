/**
 * Logger estructurado global del Target Server.
 *
 * Usamos Pino en lugar de Winston por tres razones de ingeniería:
 *   1. Es 5-8x más rápido que Winston en benchmarks de throughput.
 *   2. Emite JSON por defecto — listo para ser ingestado por cualquier
 *      agregador de logs (Loki, Datadog, CloudWatch) sin transformación.
 *   3. pino-pretty activa el formato legible SOLO en desarrollo,
 *      sin cambiar una línea de código de producción.
 *
 * Convención de niveles:
 *   logger.info  — eventos normales del ciclo de vida
 *   logger.warn  — anomalías recuperables (leak threshold, alta latencia)
 *   logger.error — errores no recuperables
 *   logger.debug — datos de telemetría por request (silenciado en prod)
 */

'use strict';

const pino = require('pino');

const isDevelopment = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDevelopment ? 'debug' : 'info'),

  // En desarrollo: salida human-readable con colores.
  // En producción: JSON puro para ingestión por el agregador de logs.
  transport: isDevelopment
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' } }
    : undefined,

  // Campos base que aparecen en TODOS los logs — clave para trazabilidad
  base: {
    service: 'saf-target-server',
    version: '2.0.0',
    // El worker ID se inyecta desde cluster.js via variable de entorno
    workerId: process.env.WORKER_ID ?? 'standalone',
  },
});

module.exports = logger;