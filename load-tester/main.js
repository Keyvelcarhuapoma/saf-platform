/**
 * S.A.F. — Load Tester
 * Orquestador Principal de Escenarios
 *
 * Este archivo es el punto de entrada para k6 (`k6 run main.js`).
 * Define la topología completa de la prueba:
 *   - 3 escenarios paralelos con personalidades distintas
 *   - Thresholds por escenario + thresholds globales de aborto
 *   - Duración total de la prueba: ~15 minutos
 *
 * ARQUITECTURA DE ESCENARIOS:
 *
 *   t=0min  ──────────────────────────────────────── t=15min
 *   [baseline_traffic  ] ░░░░░░░░░░░░░░░░░░░░░░░░░  (constante, bajo)
 *   [business_spike    ]      ▁▃▅▇▇▇▇▅▃▁             (campana asimétrica)
 *   [chaos_injection   ] ▃░▂▅░░▇▅░▂▅░▃░░▅▂░▃         (aleatorio, gradual→pico)
 *
 * DECISIÓN DE DATASET:
 *   La carga del chaos_injection fue calibrada deliberadamente para producir
 *   una degradación gradual de ~8-10 minutos antes del colapso.
 *   Esto garantiza que XGBoost vea la curva completa:
 *     Fase 1 (0-3min):   estado sano — baseline de métricas normales
 *     Fase 2 (3-7min):   degradación gradual — el "knee point" que el modelo debe aprender
 *     Fase 3 (7-11min):  colapso progresivo — latencia exponencial, errores crecientes
 *     Fase 4 (11-15min): recuperación parcial — el GC intenta liberar, leak persiste
 */

import http                    from 'k6/http';
import baselineScenario        from './scenarios/baseline.js';
import businessSpikeScenario   from './scenarios/business_spike.js';
import chaosInjectionScenario  from './scenarios/chaos_injection.js';

export { baselineScenario, businessSpikeScenario, chaosInjectionScenario };

export const options = {

  scenarios: {

    /**
     * ESCENARIO 1: Tráfico de baseline constante
     *
     * Sin cambios respecto a la versión anterior — ya era correcto.
     * 3 req/s constantes durante toda la prueba establecen el piso
     * de métricas saludables que el modelo usará como referencia.
     */
    baseline_traffic: {
      executor:        'constant-arrival-rate',
      exec:            'baselineScenario',
      rate:            3,
      timeUnit:        '1s',
      duration:        '15m',
      preAllocatedVUs: 5,
      maxVUs:          15,
      tags:            { scenario: 'baseline' },
    },

    /**
     * ESCENARIO 2: Spike de horas pico
     *
     * Sin cambios — la curva de campana asimétrica ya era correcta.
     * La rampa de 3min antes del pico da tiempo al agente de telemetría
     * para capturar la degradación gradual del servidor antes del colapso.
     */
    business_hours_spike: {
      executor:        'ramping-arrival-rate',
      exec:            'businessSpikeScenario',
      startRate:       0,
      timeUnit:        '1s',
      preAllocatedVUs: 20,
      maxVUs:          80,
      stages: [
        { duration: '3m',  target: 10 },   // Rampa de apertura
        { duration: '5m',  target: 10 },   // Pico sostenido
        { duration: '3m',  target: 20 },   // Sobrecarga máxima
        { duration: '2m',  target: 5  },   // Bajada gradual
        { duration: '2m',  target: 1  },   // Cooldown con datos de recuperación
      ],
      tags: { scenario: 'business_spike' },
    },

    /**
     * ESCENARIO 3: Inyección de caos — CALIBRADO
     *
     * CAMBIO CRÍTICO vs versión anterior:
     *   Versión anterior: llegaba a 25 req/s en 4 minutos → colapso inmediato
     *   Esta versión:     llega a 15 req/s en 9 minutos → degradación gradual
     *
     * La reducción de picos (25→15) y el alargamiento de rampas (2min→3min)
     * produce una curva de degradación con pendiente más suave que le da
     * al Telemetry Agent tiempo para capturar el "knee point" completo.
     *
     * Curva de carga calibrada:
     *   0-3min:  sube de 0 a 3 req/s   — calentamiento lento, servidor sano
     *   3-5min:  baja a 1 req/s        — primer valle, datos de recuperación parcial
     *   5-8min:  sube a 8 req/s        — primer burst moderado, inicio de degradación
     *   8-10min: baja a 2 req/s        — segundo valle, el GC intenta recuperar
     *   10-13min: sube a 15 req/s      — burst máximo calibrado, colapso controlado
     *   13-15min: baja a 0 req/s       — silencio post-caos, datos de cooldown
     */
    chaos_injection: {
      executor:        'ramping-arrival-rate',
      exec:            'chaosInjectionScenario',
      startRate:       0,
      timeUnit:        '1s',
      preAllocatedVUs: 15,
      maxVUs:          80,         // Reducido de 100 — consistente con la carga calibrada
      stages: [
        { duration: '3m',  target: 3  },   // era: 2m→5  | ahora: 3m→3  (arranque suave)
        { duration: '2m',  target: 1  },   // igual — valle de recuperación
        { duration: '3m',  target: 8  },   // era: 3m→15 | ahora: 3m→8  (burst moderado)
        { duration: '2m',  target: 2  },   // igual — segundo valle
        { duration: '3m',  target: 15 },   // era: 3m→25 | ahora: 3m→15 (pico controlado)
        { duration: '2m',  target: 0  },   // igual — cooldown final
      ],
      tags: { scenario: 'chaos_injection' },
    },
  },

  // ── Thresholds — CALIBRADOS ─────────────────────────────────────────────────
  thresholds: {

    // Tasa de errores 5xx — aborta si supera 50% sostenido
    // delayAbortEval extendido a 8m para capturar la curva completa de degradación
    // antes de decidir si el test falla. La versión anterior abortaba a los 3m
    // cortando el dataset justo cuando empezaba a ser interesante para el ML.
    'saf_error_rate_5xx': [
      {
        threshold:      'rate < 0.50',
        abortOnFail:    true,
        delayAbortEval: '8m',      // era '2m' — ahora espera 8min antes de abortar
      },
    ],

    // Latencia P95 — aborta si supera 5s sostenido
    // delayAbortEval extendido a 10m por la misma razón: necesitamos ver
    // la fase de degradación completa antes del corte de emergencia.
    'saf_status_latency_ms': [
      {
        threshold:      'p(95) < 5000',
        abortOnFail:    true,
        delayAbortEval: '10m',     // era '3m' — extendido para capturar el knee point
      },
      // Threshold informativo P99 — no aborta, solo registra en el resumen final
      { threshold: 'p(99) < 10000' },  // subido de 8s a 10s — más realista bajo colapso
    ],

    // /health debe mantenerse bajo presión — threshold informativo
    'saf_health_latency_ms': [
      { threshold: 'p(95) < 1500' },  // subido de 1s a 1.5s — más tolerante bajo carga
    ],

    // Tasa de timeouts — threshold informativo
    'saf_timeout_rate': [
      { threshold: 'rate < 0.40' },   // subido de 0.30 a 0.40 — esperamos más timeouts
    ],

    // Métricas nativas de k6
    'http_req_failed':   [{ threshold: 'rate < 0.50' }],
    'http_req_duration': [
      {
        threshold:      'p(90) < 6000',  // subido de 4s a 6s — consistente con carga real
        abortOnFail:    false,            // solo informativo — el aborto lo maneja saf_status_latency_ms
      },
    ],
  },
};

/**
 * Setup — verificación del Target Server antes de lanzar el caos.
 * Con el import de http en el top del archivo (init stage), k6
 * puede usar http aquí sin restricciones.
 */
export function setup() {
  const BASE_URL    = __ENV.TARGET_URL || 'http://localhost:3001';
  const healthCheck = http.get(`${BASE_URL}/health`, { timeout: '5s' });

  if (healthCheck.status !== 200) {
    throw new Error(
      `Target Server no disponible en ${BASE_URL}/health ` +
      `(HTTP ${healthCheck.status}) — abortando prueba antes de comenzar`
    );
  }

  console.log(`✓ Target Server verificado en ${BASE_URL} — iniciando prueba de caos`);

  return {
    targetUrl: BASE_URL,
    startedAt: new Date().toISOString(),
  };
}

/**
 * Teardown — resumen final de la prueba.
 */
export function teardown(data) {
  console.log(`✓ Prueba de caos completada`);
  console.log(`  Target:  ${data.targetUrl}`);
  console.log(`  Inicio:  ${data.startedAt}`);
  console.log(`  Fin:     ${new Date().toISOString()}`);
  console.log(`  Dataset: InfluxDB → bucket saf_telemetry`);
}

/**
 * Función default requerida por k6 cuando se usan escenarios con exec explícito.
 * Nunca es llamada directamente — cada escenario tiene su propio exec.
 */
export default function () {}