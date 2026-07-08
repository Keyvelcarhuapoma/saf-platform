/**
 * Router: /api/status, /health, /api/reset
 *
 * Responsabilidad única: orquestar los vectores de caos y construir
 * la respuesta de telemetría. No contiene lógica de caos — delega
 * completamente a los módulos de chaos/.
 */

'use strict';

const express = require('express');
const crypto  = require('crypto');

const logger              = require('../logger');
const { injectLeak,
        flushLeak,
        getBucketSizeMB } = require('../chaos/memoryLeak');
const { stressCpu }       = require('../chaos/cpuStress');
const { applyNetworkDelay }= require('../chaos/networkDelay');
const { eventLoopLagMiddleware } = require('../middleware/eventLoopLag');
const config              = require('../config');

const router = express.Router();

/**
 * GET /api/status
 *
 * Endpoint principal de degradación. Secuencia de ejecución:
 *   1. Middleware mide Event Loop Lag antes de la request
 *   2. Inyecta memory leak
 *   3. Estresa CPU (bloqueante — se siente como latencia de red desde el cliente)
 *   4. Aplica network delay simulado (no bloqueante — libera event loop)
 *   5. Construye y retorna payload de telemetría completo
 */
router.get('/api/status', eventLoopLagMiddleware, async (req, res) => {
  // ── 1. Memory Leak ───────────────────────────────────────────────────────
  const leakStats     = injectLeak();
  const heapPressureKB = leakStats.bucketSizeMB * 1024;

  // ── 2. CPU Stress (síncrono — bloquea antes del delay) ──────────────────
  const cpuStats      = stressCpu(heapPressureKB);

  // ── 3. Network Delay (asíncrono — no bloquea el event loop) ─────────────
  const delayStats    = await applyNetworkDelay(heapPressureKB);

  // ── 4. Construcción del payload de telemetría ───────────────────────────
  const memUsage      = process.memoryUsage();
  const requestDuration = parseFloat(
    (Number(process.hrtime.bigint() - req.metrics.requestStartedAt) / 1_000_000).toFixed(2)
  );

  const payload = {
    // Identificador único de esta muestra — útil para correlación en InfluxDB
    sampleId:       crypto.randomUUID(),
    timestamp:      new Date().toISOString(),
    workerId:       process.env.WORKER_ID ?? 'standalone',

    // ── Métricas de salud del proceso ──────────────────────────────────────
    process: {
      uptimeSeconds:  parseFloat(process.uptime().toFixed(2)),
      // Event Loop Lag: la métrica más crítica para detectar colapso inminente
      eventLoopLagMs: req.metrics.eventLoopLagMs,
      requestDurationMs: requestDuration,
    },

    // ── Métricas de memoria ────────────────────────────────────────────────
    // Estas son las series temporales primarias para el modelo predictivo
    memory: {
      heapUsedMB:   parseFloat((memUsage.heapUsed  / 1_048_576).toFixed(2)),
      heapTotalMB:  parseFloat((memUsage.heapTotal / 1_048_576).toFixed(2)),
      rssMB:        parseFloat((memUsage.rss       / 1_048_576).toFixed(2)),
      externalMB:   parseFloat((memUsage.external  / 1_048_576).toFixed(2)),
      // Tamaño del leak bucket — proxy directo de la "antigüedad" del fallo
      leakBucketMB: leakStats.bucketSizeMB,
    },

    // ── Métricas de CPU ────────────────────────────────────────────────────
    cpu: {
      stressEnabled:      config.chaos.cpuStress.enabled,
      stressDurationMs:   cpuStats.durationMs,
      pbkdf2Iterations:   cpuStats.iterations,
    },

    // ── Métricas de red simulada ───────────────────────────────────────────
    network: {
      delayEnabled:   config.chaos.networkDelay.enabled,
      delayMs:        delayStats.delayMs,
    },
  };

  logger.debug({
    eventLoopLagMs:  payload.process.eventLoopLagMs,
    heapUsedMB:      payload.memory.heapUsedMB,
    leakBucketMB:    payload.memory.leakBucketMB,
    cpuStressMs:     payload.cpu.stressDurationMs,
    networkDelayMs:  payload.network.delayMs,
    totalDurationMs: requestDuration,
  }, `Telemetría generada`);

  res.json(payload);
});

/**
 * GET /health
 *
 * Healthcheck sin efectos secundarios.
 * Usado por el Telemetry Agent y load balancers para verificar liveness.
 * No aplica degradación — responde siempre lo más rápido posible.
 */
router.get('/health', (req, res) => {
  res.json({
    status:       'alive',
    timestamp:    new Date().toISOString(),
    workerId:     process.env.WORKER_ID ?? 'standalone',
    uptimeSeconds: parseFloat(process.uptime().toFixed(2)),
    heapUsedMB:   parseFloat((process.memoryUsage().heapUsed / 1_048_576).toFixed(2)),
  });
});

/**
 * POST /api/reset
 *
 * Reinicia el estado de caos del worker sin reiniciar el proceso.
 * Útil para ejecutar múltiples rondas de pruebas desde k6 sin downtime.
 * NOTA: Solo reinicia el worker que recibe la request. En modo cluster,
 * enviar N requests garantiza el reset de todos los workers.
 */
router.post('/api/reset', (req, res) => {
  const releasedMB = flushLeak();

  logger.info({ releasedMB, workerId: process.env.WORKER_ID ?? 'standalone' },
    `Estado de caos reiniciado vía POST /api/reset`);

  res.json({
    status:      'reset_complete',
    timestamp:   new Date().toISOString(),
    workerId:    process.env.WORKER_ID ?? 'standalone',
    releasedMB,
  });
});

module.exports = router;