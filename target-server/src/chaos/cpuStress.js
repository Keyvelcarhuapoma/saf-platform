/**
 * Vector de Caos #2 — CPU Stress (Event Loop Starvation).
 *
 * TÉCNICA: crypto.pbkdf2Sync
 *   Por qué NO usamos Fibonacci:
 *     V8 es extremadamente bueno optimizando loops simples con enteros pequeños.
 *     En pruebas reales, V8 convierte fib(40) en un cómputo casi instantáneo
 *     después de las primeras llamadas (JIT compilation). No es un estresor fiable.
 *
 *   Por qué SÍ usamos pbkdf2Sync:
 *     1. Es una operación criptográfica real implementada en C++ (OpenSSL).
 *        V8 NO puede JIT-optimizarla — cada llamada cuesta lo mismo.
 *     2. Es SÍNCRONA por diseño del estándar Node.js, bloqueando el
 *        event loop durante toda la operación.
 *     3. El número de iteraciones escala directamente con la carga de CPU
 *        de forma predecible y medible.
 *     4. Los sistemas de producción reales HACEN esto (hashing de passwords).
 *        Nuestro modelo ML aprenderá a reconocer un patrón de carga legítimo.
 *
 *   Resultado: el event loop queda bloqueado de forma genuina, el OS reporta
 *   100% CPU en ese core, y el Event Loop Lag sube de forma medible.
 */

'use strict';

const crypto = require('crypto');
const logger  = require('../logger');
const config  = require('../config');

/**
 * Ejecuta el estresor de CPU de forma síncrona y bloqueante.
 * Retorna el tiempo real de ejecución para incluirlo en la telemetría.
 *
 * @param {number} heapPressureKB - Presión actual del heap de fuga.
 *                                   Escala las iteraciones dinámicamente.
 * @returns {{ durationMs: number, iterations: number }}
 */
function stressCpu(heapPressureKB) {
  if (!config.chaos.cpuStress.enabled) {
    return { durationMs: 0, iterations: 0 };
  }

  // Las iteraciones escalan con la presión del heap.
  // A 0 KB de leak: iteraciones base (50k). A 200 MB: ~1.5x más.
  // Esto crea la correlación multivariable que XGBoost necesita detectar.
  const scaleFactor  = 1 + (heapPressureKB / 204800); // 204800 = 200MB en KB
  const iterations   = Math.floor(config.chaos.cpuStress.pbkdf2Iterations * scaleFactor);

  const startHrtime = process.hrtime.bigint();

  // pbkdf2Sync: bloquea el event loop. Parámetros diseñados para ser costosos.
  crypto.pbkdf2Sync(
    'saf-chaos-payload',   // password (dato arbitrario)
    'saf-salt-vector',     // salt (dato arbitrario)
    iterations,            // iteraciones — aquí está el costo
    32,                    // keylen en bytes
    'sha256'               // digest — SHA-256 es estándar y bien calibrado
  );

  const durationMs = Number(process.hrtime.bigint() - startHrtime) / 1_000_000;

  logger.debug({ iterations, durationMs: durationMs.toFixed(2) },
    `CPU stress completado`);

  return { durationMs: parseFloat(durationMs.toFixed(2)), iterations };
}

module.exports = { stressCpu };