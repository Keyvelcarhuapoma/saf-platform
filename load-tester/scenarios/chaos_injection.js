/**
 * S.A.F. — Load Tester
 * Escenario: Chaos Injection
 *
 * PROPÓSITO EN EL DATASET DE ML:
 *   Genera el ruido estocástico que hace al modelo XGBoost robusto.
 *   Sin este escenario, el modelo aprendería curvas demasiado limpias
 *   que no existen en producción real. El caos introduce:
 *     - Ráfagas de tráfico impredecibles (bursts)
 *     - Períodos de silencio repentino (lulls)
 *     - Patrones de acceso no lineales
 *     - Varianza alta en los tiempos entre requests
 *
 * MATEMÁTICA DEL COMPORTAMIENTO ESTOCÁSTICO:
 *   Usamos tres distribuciones de probabilidad distintas para los sleeps,
 *   seleccionadas aleatoriamente en cada iteración. Esto produce una
 *   distribución multimodal del think time — exactamente lo que se
 *   observa en tráfico real de producción con múltiples tipos de usuarios.
 */

import http      from 'k6/http';
import { sleep } from 'k6';
import { check } from 'k6';
import { recordRequestMetrics, iterationDuration } from '../lib/metrics.js';
import { weightedEndpoint, endpointURL }           from '../lib/endpoints.js';

// ── Generadores de distribuciones de probabilidad ─────────────────────────────

/**
 * Distribución Exponencial — modela el tiempo entre eventos de Poisson.
 * En teoría de colas, los usuarios reales llegan según un proceso de Poisson,
 * por lo que el tiempo entre llegadas sigue una distribución exponencial.
 *
 * Fórmula: -ln(U) / λ, donde U ~ Uniform(0,1) y λ = tasa de llegadas.
 * Con λ=1: media=1s, alta probabilidad de valores pequeños (bursts frecuentes)
 * Con λ=0.3: media=3.3s, llegadas más espaciadas.
 *
 * @param {number} lambda - Tasa de llegadas (mayor λ = sleeps más cortos)
 * @returns {number} - Tiempo de sleep en segundos
 */
function exponentialSleep(lambda) {
  // Evitamos log(0) = -Infinity con Math.max
  return -Math.log(Math.max(Math.random(), 1e-10)) / lambda;
}

/**
 * Distribución Pareto — modela el principio 80/20 del tráfico web.
 * La mayoría de usuarios tienen think times cortos, pero existe una
 * cola larga (heavy tail) de usuarios muy lentos o inactivos.
 * Esto crea los "valles" entre ráfagas que se observan en tráfico real.
 *
 * Fórmula: xm / (U^(1/α)), donde:
 *   xm = valor mínimo (escala)
 *   α  = índice de forma (mayor α = cola más corta)
 *   U  ~ Uniform(0,1)
 *
 * @param {number} scale - Valor mínimo del sleep en segundos
 * @param {number} shape - Índice de forma (típicamente 1.5 para web traffic)
 * @returns {number} - Tiempo de sleep en segundos (con cap en 8s para no bloquear VUs)
 */
function paretoSleep(scale, shape) {
  const raw = scale / Math.pow(Math.random(), 1 / shape);
  // Cap en 8 segundos — sleeps más largos no aportan al test y bloquean VUs
  return Math.min(raw, 8);
}

/**
 * Distribución Bimodal — mezcla dos gaussianas.
 * Modela la coexistencia de dos tipos de usuarios simultáneos:
 *   Modo 1: usuarios interactivos (think time corto ~0.2s)
 *   Modo 2: usuarios batch/automatizados (think time largo ~3s)
 * La selección entre modos se hace con probabilidad `p` para el modo corto.
 *
 * Aproximación gaussiana via Box-Muller (misma técnica que en el Target Server):
 *   Z = sqrt(-2·ln(U1)) · cos(2π·U2)
 *
 * @param {number} p - Probabilidad de caer en el modo rápido (0.0 - 1.0)
 * @returns {number} - Tiempo de sleep en segundos (mínimo 0.05s)
 */
function bimodalSleep(p) {
  // Generamos una muestra gaussiana via Box-Muller
  const u1 = Math.max(Math.random(), 1e-10);
  const u2 = Math.random();
  const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  let sample;
  if (Math.random() < p) {
    // Modo rápido: media=0.2s, desviación=0.1s — usuarios interactivos
    sample = 0.2 + 0.1 * z;
  } else {
    // Modo lento: media=3.0s, desviación=1.0s — usuarios batch
    sample = 3.0 + 1.0 * z;
  }

  // Clampeamos en 0.05s para evitar sleeps negativos o de 0ms exacto
  return Math.max(sample, 0.05);
}

/**
 * Selecciona aleatoriamente una de las tres distribuciones de sleep
 * y retorna el tiempo de espera resultante.
 *
 * Probabilidades de selección de distribución:
 *   40% Exponencial — bursts frecuentes, modela llegadas de Poisson
 *   35% Bimodal     — mezcla de usuarios interactivos y batch
 *   25% Pareto      — cola larga, introduce los "valles" entre ráfagas
 *
 * El resultado es una distribución multimodal que imita fielmente
 * el tráfico observado en sistemas de producción reales bajo estrés.
 *
 * @returns {number} - Tiempo de sleep en segundos
 */
function chaosSleep() {
  const dice = Math.random();

  if (dice < 0.40) {
    // Exponencial con λ=1.5: media ~0.67s — modo burst agresivo
    return exponentialSleep(1.5);
  } else if (dice < 0.75) {
    // Bimodal con 60% de probabilidad para el modo rápido
    return bimodalSleep(0.6);
  } else {
    // Pareto con escala=0.3s, shape=1.5 — cola larga ocasional
    return paretoSleep(0.3, 1.5);
  }
}

/**
 * Función principal del escenario chaos.
 * Cada iteración puede enviar entre 1 y 3 requests consecutivas
 * antes del sleep — simulando usuarios que hacen click múltiple
 * cuando el servidor está lento (comportamiento real de usuarios frustrados).
 */
export default function chaosInjectionScenario() {
  const iterStart = Date.now();

  // Ráfaga variable: entre 1 y 3 requests por iteración
  // Distribuido como: 60% → 1 req, 30% → 2 reqs, 10% → 3 reqs
  // Esto crea los picos de backpressure que buscamos
  let requestsThisIteration;
  const burstDice = Math.random();
  if (burstDice < 0.60)      requestsThisIteration = 1;
  else if (burstDice < 0.90) requestsThisIteration = 2;
  else                       requestsThisIteration = 3;

  for (let i = 0; i < requestsThisIteration; i++) {
    const endpoint = weightedEndpoint();
    const url      = endpointURL(endpoint);

    const params = {
      timeout: endpoint.timeout,
      tags:    Object.assign({}, endpoint.tags, { scenario: 'chaos_injection' }),
    };

    const response = http.get(url, params);

    check(response, {
      'chaos: servidor sigue vivo':  (r) => r.status !== 0,
      'chaos: no es error 5xx':      (r) => r.status < 500,
    });

    recordRequestMetrics(
      response.timings.duration,
      response.status,
      response.error_code === 1050,
      endpoint.name
    );

    // Micro-pausa entre requests de la misma ráfaga (10-100ms)
    // Evita que k6 detecte las requests como un batch HTTP/1.1 pipelined
    if (i < requestsThisIteration - 1) {
      sleep(0.01 + Math.random() * 0.09);
    }
  }

  iterationDuration.add(Date.now() - iterStart);

  // Sleep principal entre ráfagas — distribución multimodal caótica
  sleep(chaosSleep());
}