/**
 * S.A.F. — Load Tester
 * Escenario: Baseline Traffic
 *
 * PROPÓSITO EN EL DATASET DE ML:
 *   Establece el "estado sano" del servidor — los valores de referencia
 *   de CPU, RAM y latencia cuando no hay presión. XGBoost necesita
 *   estos datos para aprender qué significa "normal" antes de aprender
 *   qué significa "degradado".
 *
 * COMPORTAMIENTO:
 *   Carga baja y constante durante toda la prueba (3-5 VUs).
 *   Sin rampas agresivas. Tráfico de fondo que simula usuarios reales
 *   usando el sistema durante el horario normal de trabajo.
 */

import http           from 'k6/http';
import { sleep }      from 'k6';
import { check }      from 'k6';
import { recordRequestMetrics, iterationDuration } from '../lib/metrics.js';
import { weightedEndpoint, endpointURL }           from '../lib/endpoints.js';

/**
 * Función principal del escenario baseline.
 * Llamada por k6 para cada iteración de cada Virtual User.
 */
export default function baselineScenario() {
  const iterStart = Date.now();
  const endpoint  = weightedEndpoint();
  const url       = endpointURL(endpoint);

  const params = {
    timeout: endpoint.timeout,
    tags:    endpoint.tags,
  };

  const response = http.get(url, params);

  // Verificaciones básicas de correctitud
  check(response, {
    'baseline: status es 2xx':     (r) => r.status >= 200 && r.status < 300,
    'baseline: body no está vacío': (r) => r.body && r.body.length > 0,
  });

  recordRequestMetrics(
    response.timings.duration,
    response.status,
    response.error_code === 1050, // 1050 = timeout en k6
    endpoint.name
  );

  iterationDuration.add(Date.now() - iterStart);

  // Sleep gaussiano suave: entre 1s y 4s
  // Simula un usuario leyendo un dashboard entre actualizaciones
  const thinkTime = 1 + Math.random() * 3;
  sleep(thinkTime);
}