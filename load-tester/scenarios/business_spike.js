/**
 * S.A.F. — Load Tester
 * Escenario: Business Hours Spike
 *
 * PROPÓSITO EN EL DATASET DE ML:
 *   Genera el patrón de degradación gradual → pico → recuperación parcial.
 *   Este es el patrón más valioso para Prophet (series temporales):
 *   tiene una forma de campana con asimetría en la bajada (el servidor
 *   no se recupera tan rápido como se degradó — el GC tarda en liberar).
 *
 * COMPORTAMIENTO:
 *   Simula las "9am del lunes": tráfico sube progresivamente, se mantiene
 *   en el pico durante varios minutos, luego baja. El servidor intenta
 *   recuperarse pero el memory leak impide una recuperación completa.
 *
 * MODELO DE LLEGADAS:
 *   ramping-arrival-rate con open model — los usuarios siguen llegando
 *   aunque el servidor esté lento. Esto fuerza acumulación de conexiones
 *   (backpressure) que es exactamente lo que queremos medir.
 */

import http      from 'k6/http';
import { sleep } from 'k6';
import { check } from 'k6';
import { recordRequestMetrics, iterationDuration } from '../lib/metrics.js';
import { weightedEndpoint, endpointURL }           from '../lib/endpoints.js';

export default function businessSpikeScenario() {
  const iterStart = Date.now();
  const endpoint  = weightedEndpoint();
  const url       = endpointURL(endpoint);

  const params = {
    timeout: endpoint.timeout,
    tags:    Object.assign({}, endpoint.tags, { scenario: 'business_spike' }),
  };

  const response = http.get(url, params);

  check(response, {
    'spike: status es 2xx':          (r) => r.status >= 200 && r.status < 300,
    'spike: latencia < 5s':          (r) => r.timings.duration < 5000,
    'spike: no hay error de servidor':(r) => r.status < 500,
  });

  recordRequestMetrics(
    response.timings.duration,
    response.status,
    response.error_code === 1050,
    endpoint.name
  );

  iterationDuration.add(Date.now() - iterStart);

  // Think time más corto que baseline — simula usuarios de negocio
  // bajo presión de tiempo (reportes de fin de mes, cierres de jornada)
  const thinkTime = 0.5 + Math.random() * 1.5;
  sleep(thinkTime);
}