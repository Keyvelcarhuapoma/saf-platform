/**
 * Vector de Caos #1 — Memory Leak.
 *
 * TÉCNICA: Buffer.allocUnsafe en lugar de Buffer.alloc.
 *   - Buffer.alloc(n, 0xFF): inicializa cada byte, 100% CPU por bloque.
 *   - Buffer.allocUnsafe(n): no inicializa — el OS asigna la página de memoria
 *     física SOLO cuando el proceso la toca (write). Al hacer buffer.fill()
 *     inmediatamente después, forzamos el acceso real a cada página,
 *     haciendo la asignación de memoria VISIBLE al OS y al agente de telemetría.
 *
 * Por qué escapa al GC:
 *   El array `_leakBucket` es una referencia raíz (alcanzable desde el scope
 *   del módulo). V8 no puede recolectar ningún elemento mientras exista
 *   una referencia viva al array. Los Buffers además viven en memoria
 *   externa al heap de V8 (ArrayBuffer en la heap de C++), lo que los hace
 *   aún más difíciles de liberar.
 */

'use strict';

const logger = require('../logger');
const config = require('../config');

// Referencia raíz que mantiene todos los bloques vivos — never garbage collected
const _leakBucket = [];

/**
 * Inyecta un bloque de memoria al bucket de fuga.
 * Llamado en cada request a /api/status cuando ENABLE_MEM_LEAK=true.
 *
 * @returns {{ bucketLength: number, bucketSizeMB: number }}
 */
function injectLeak() {
  if (!config.chaos.memLeak.enabled) {
    return { bucketLength: _leakBucket.length, bucketSizeMB: getBucketSizeMB() };
  }

  const block = Buffer.allocUnsafe(config.chaos.memLeak.blockBytes);
  // Escribir en el buffer fuerza la asignación de páginas físicas de memoria
  block.fill(0xAB);
  _leakBucket.push(block);

  const sizeMB = getBucketSizeMB();

  // Advertencia cuando el leak supera los 200MB — útil para observar el umbral crítico
  if (_leakBucket.length % 200 === 0) {
    logger.warn({ bucketLength: _leakBucket.length, bucketSizeMB: sizeMB },
      `Umbral de memory leak alcanzado — posible colapso próximo`);
  }

  return { bucketLength: _leakBucket.length, bucketSizeMB: sizeMB };
}

/**
 * Libera todos los bloques del bucket (usado en /api/reset).
 * Nota: la liberación real de memoria ocurre en el próximo ciclo del GC.
 */
function flushLeak() {
  const released = getBucketSizeMB();
  _leakBucket.length = 0;
  logger.info({ releasedMB: released }, `Memory leak bucket vaciado — esperando ciclo GC`);
  return released;
}

/**
 * Retorna el tamaño actual del bucket en MB.
 */
function getBucketSizeMB() {
  return parseFloat(
    ((_leakBucket.length * config.chaos.memLeak.blockBytes) / 1024 / 1024).toFixed(2)
  );
}

module.exports = { injectLeak, flushLeak, getBucketSizeMB };