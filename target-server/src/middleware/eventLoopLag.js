/**
 * Middleware de métricas: Event Loop Lag.
 *
 * ¿Qué es el Event Loop Lag?
 *   Node.js es single-threaded. Si una operación síncrona (como nuestro
 *   pbkdf2Sync) bloquea el event loop, los callbacks de setTimeout programados
 *   para ejecutarse en Xms se ejecutan más tarde. La diferencia entre el tiempo
 *   ESPERADO y el tiempo REAL de ejecución es el "Event Loop Lag".
 *
 *   Es la métrica más crítica de salud de un proceso Node.js.
 *   Un lag < 10ms: sistema sano.
 *   Un lag de 50-100ms: system bajo presión.
 *   Un lag > 200ms: sistema en estado crítico, timeouts inminentes.
 *
 * IMPLEMENTACIÓN:
 *   Programamos un setTimeout de 0ms antes de cada request.
 *   En condiciones ideales, ejecutaría en exactamente 0ms.
 *   En la práctica, se ejecuta en `lagMs` ms — eso es el lag real.
 *
 *   Adjuntamos el lag medido a `req.metrics` para que el route handler
 *   lo incluya en la respuesta JSON y el Telemetry Agent lo capture.
 */

'use strict';

const logger = require('../logger');

/**
 * Middleware Express que mide el Event Loop Lag y el tiempo de la request.
 * Adjunta `req.metrics` con los datos para uso downstream.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function eventLoopLagMiddleware(req, res, next) {
  // Timestamp de inicio de la request (nanosegundos — máxima precisión)
  const requestStartHrtime = process.hrtime.bigint();

  // Timestamp programado — usamos hrtime para evitar deriva del reloj del sistema
  const scheduledAt = process.hrtime.bigint();

  // Un setTimeout de 0ms que se ejecuta en el próximo "tick" del event loop.
  // Si el event loop está ocupado, tardará más — esa diferencia es el lag.
  setTimeout(() => {
    const lagNs  = process.hrtime.bigint() - scheduledAt;
    const lagMs  = parseFloat((Number(lagNs) / 1_000_000).toFixed(3));

    // Inyectamos las métricas en el objeto request para uso en route handlers
    req.metrics = {
      eventLoopLagMs:  lagMs,
      requestStartedAt: requestStartHrtime,
    };

    if (lagMs > 100) {
      logger.warn({ lagMs }, `Event Loop Lag elevado — CPU probablemente saturado`);
    }

    next();
  }, 0);
}

module.exports = { eventLoopLagMiddleware };