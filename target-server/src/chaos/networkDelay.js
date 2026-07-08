/**
 * Vector de Caos #3 — Network Delay con curva exponencial + ruido gaussiano.
 *
 * MODELO MATEMÁTICO:
 *   delay(t) = baseMs × e^(k × heapKB) + Gaussian(0, σ)
 *
 *   Donde:
 *     baseMs  = latencia base en ms cuando el sistema está sano
 *     k       = factor exponencial (controla la agresividad del colapso)
 *     heapKB  = tamaño del leak bucket (proxy de la "presión total del sistema")
 *     σ       = desviación estándar del ruido gaussiano
 *
 * Por qué curva exponencial y no lineal:
 *   Los sistemas reales bajo presión no degradan linealmente.
 *   La latencia P99 es estable durante un tiempo (la "fase plateau"),
 *   luego se dispara de forma abrupta (el "knee point" o punto de quiebre).
 *   Este patrón de "hockey stick" es exactamente lo que Prophet y XGBoost
 *   deben aprender a detectar ANTES de que ocurra.
 *
 * Por qué ruido gaussiano (Box-Muller):
 *   Sin ruido, el predictor aprende una curva matemáticamente perfecta
 *   que no existe en producción. El ruido hace que el dataset de entrenamiento
 *   sea estadísticamente honesto y fuerza al modelo a aprender la tendencia
 *   subyacente en lugar de la función exacta.
 */

'use strict';

const logger = require('../logger');
const config = require('../config');

/**
 * Genera una muestra de distribución normal usando la transformación Box-Muller.
 * Es determinista, O(1) y no requiere dependencias externas.
 *
 * @param {number} mean   - Media de la distribución
 * @param {number} stdDev - Desviación estándar
 * @returns {number}
 */
function sampleGaussian(mean, stdDev) {
  // u1 y u2 en (0, 1) — excluimos 0 para evitar log(0) = -Infinity
  const u1 = 1 - Math.random();
  const u2 = 1 - Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + stdDev * z0;
}

/**
 * Calcula el delay a inyectar y retorna una Promise que resuelve tras ese tiempo.
 *
 * @param {number} heapPressureKB - Proxy de presión del sistema (tamaño del leak)
 * @returns {Promise<{ delayMs: number }>}
 */
async function applyNetworkDelay(heapPressureKB) {
  if (!config.chaos.networkDelay.enabled) {
    return { delayMs: 0 };
  }

  const { baseMs, expFactor, noiseStdDev } = config.chaos.networkDelay;

  // Componente determinista: curva exponencial base
  const exponentialComponent = baseMs * Math.exp(expFactor * heapPressureKB);

  // Componente estocástico: ruido gaussiano centrado en 0
  const gaussianComponent = sampleGaussian(0, noiseStdDev);

  // Cap máximo de 8s — previene overflow exponencial cuando el heap es muy grande
  // Sin este cap, Math.exp() desborda a valores > 1e20 con heaps > 200MB
  const MAX_DELAY_MS = 8_000;
  const delayMs = Math.min(
    MAX_DELAY_MS,
    Math.max(0, exponentialComponent + gaussianComponent)
  );

  logger.debug(
    { heapPressureKB, exponentialComponent: exponentialComponent.toFixed(2), gaussianComponent: gaussianComponent.toFixed(2), delayMs: delayMs.toFixed(2) },
    `Network delay calculado`
  );

  // Esperamos el delay calculado — esto libera el event loop (no bloqueante)
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  return { delayMs: parseFloat(delayMs.toFixed(2)) };
}

module.exports = { applyNetworkDelay, sampleGaussian };