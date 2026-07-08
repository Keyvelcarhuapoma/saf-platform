/**
 * S.A.F. — Load Tester
 * Módulo: Custom Metrics Centralizadas
 *
 * Todas las métricas personalizadas de k6 viven aquí.
 * Importar desde este módulo garantiza que no haya duplicación
 * de instancias de métricas entre escenarios (k6 lanza cada
 * escenario en su propio contexto pero comparte el estado de métricas
 * globales cuando se importan desde un módulo común).
 */

import { Trend, Rate, Counter } from 'k6/metrics';

// ── Trends de Latencia ────────────────────────────────────────────────────────
// Trend acumula todos los valores y permite calcular percentiles arbitrarios.
// Los thresholds globales en main.js referencian estos nombres exactos.

/**
 * Latencia end-to-end de cada request al endpoint /api/status.
 * Nos interesa el P90, P95 y P99 — los percentiles altos revelan
 * cuándo el servidor empieza a colapsar bajo los usuarios más lentos.
 */
export const statusLatency = new Trend('saf_status_latency_ms', true);

/**
 * Latencia específica del endpoint /health.
 * Debe mantenerse baja incluso bajo presión — si /health se degrada,
 * el servidor está en estado crítico irrecuperable.
 */
export const healthLatency = new Trend('saf_health_latency_ms', true);

/**
 * Duración total del ciclo completo de un Virtual User:
 * incluye sleeps estocásticos + tiempo de requests.
 * Útil para detectar cuándo el backpressure empieza a encolar VUs.
 */
export const iterationDuration = new Trend('saf_iteration_duration_ms', true);

// ── Rates de Error ────────────────────────────────────────────────────────────
// Rate calcula la proporción de eventos "verdaderos" sobre el total.
// Valor 0.0 = 0% de errores, 1.0 = 100% de errores.

/**
 * Tasa de respuestas HTTP 5xx (500, 503, 502).
 * Threshold de aborto: si supera 0.50 de forma sostenida → test fallido.
 */
export const errorRate5xx = new Rate('saf_error_rate_5xx');

/**
 * Tasa de timeouts (requests que no reciben respuesta en tiempo límite).
 * Señal temprana de colapso — aparece antes que los 5xx.
 */
export const timeoutRate = new Rate('saf_timeout_rate');

/**
 * Tasa de requests que superaron el umbral de latencia crítica (>2000ms).
 * Permite identificar el momento exacto del "knee point" de degradación.
 */
export const criticalLatencyRate = new Rate('saf_critical_latency_rate');

// ── Counters Absolutos ────────────────────────────────────────────────────────
// Counter solo sube — acumula eventos a lo largo de toda la prueba.

/**
 * Total de requests exitosas (2xx) procesadas durante la prueba completa.
 */
export const successfulRequests = new Counter('saf_successful_requests_total');

/**
 * Total de requests fallidas por cualquier razón (5xx + timeout + network error).
 */
export const failedRequests = new Counter('saf_failed_requests_total');

/**
 * Registra una muestra de latencia en todas las métricas relevantes
 * y actualiza los counters de éxito/error.
 *
 * @param {number}  durationMs  - Duración de la request en milisegundos
 * @param {number}  statusCode  - Código HTTP de la respuesta
 * @param {boolean} isTimeout   - True si la request terminó por timeout
 * @param {string}  endpoint    - Nombre del endpoint ('status' | 'health')
 */
export function recordRequestMetrics(durationMs, statusCode, isTimeout, endpoint) {
  // Registramos latencia en el Trend correspondiente al endpoint
  if (endpoint === 'status') {
    statusLatency.add(durationMs);
  } else if (endpoint === 'health') {
    healthLatency.add(durationMs);
  }

  const is5xx    = statusCode >= 500 && statusCode < 600;
  const isError  = is5xx || isTimeout || statusCode === 0;

  // Actualizamos rates — add(true) suma al numerador, add(false) solo al denominador
  errorRate5xx.add(is5xx);
  timeoutRate.add(isTimeout);
  criticalLatencyRate.add(durationMs > 2000);

  // Actualizamos counters absolutos
  if (isError) {
    failedRequests.add(1);
  } else {
    successfulRequests.add(1);
  }
}