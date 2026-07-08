/**
 * Módulo de configuración centralizado.
 *
 * Toda variable de entorno del sistema pasa por aquí.
 * Principio de ingeniería: un único punto de verdad para la config.
 * Si una variable falta o tiene un valor inválido, fallamos RÁPIDO
 * en el arranque (fail-fast) en lugar de fallar silenciosamente
 * en producción con un comportamiento inesperado.
 */

'use strict';

require('dotenv').config();

const logger = require('../logger');

/**
 * Parsea una variable de entorno como booleano.
 * Acepta "true" / "false" (case-insensitive). Default: false.
 * @param {string} key
 * @param {boolean} defaultValue
 */
function parseBoolean(key, defaultValue = false) {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  return raw.toLowerCase() === 'true';
}

/**
 * Parsea una variable de entorno como entero.
 * Si el valor no es un número válido, lanza un error (fail-fast).
 * @param {string} key
 * @param {number} defaultValue
 */
function parseInteger(key, defaultValue) {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    // Fallamos en el arranque — mejor que un NaN silencioso en producción
    logger.error({ key, raw }, `Variable de entorno inválida: se esperaba un entero`);
    process.exit(1);
  }
  return parsed;
}

/**
 * Parsea una variable de entorno como float.
 * @param {string} key
 * @param {number} defaultValue
 */
function parseFloat_(key, defaultValue) {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  const parsed = parseFloat(raw);
  if (isNaN(parsed)) {
    logger.error({ key, raw }, `Variable de entorno inválida: se esperaba un número decimal`);
    process.exit(1);
  }
  return parsed;
}

const config = Object.freeze({
  server: {
    port: parseInteger('PORT', 3001),
  },

  chaos: {
    memLeak: {
      enabled:        parseBoolean('ENABLE_MEM_LEAK', true),
      blockBytes:     parseInteger('LEAK_BLOCK_BYTES', 98304),
    },
    cpuStress: {
      enabled:        parseBoolean('ENABLE_CPU_STRESS', true),
      // Iteraciones de pbkdf2Sync — a 50k tarda ~80ms en un core moderno
      pbkdf2Iterations: parseInteger('CPU_PBKDF2_ITERATIONS', 50000),
    },
    networkDelay: {
      enabled:        parseBoolean('ENABLE_NETWORK_DELAY', true),
      baseMs:         parseInteger('DELAY_BASE_MS', 40),
      expFactor:      parseFloat_('DELAY_EXP_FACTOR', 0.00010),
      noiseStdDev:    parseFloat_('DELAY_NOISE_STD_DEV', 18),
    },
  },
});

module.exports = config;