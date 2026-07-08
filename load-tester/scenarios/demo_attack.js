/**
 * S.A.F. — Demo Attack Script
 *
 * DISEÑADO ESPECÍFICAMENTE para la demo de presentación.
 * Objetivo: llevar el sistema de HEALTHY → DEGRADING → CRITICAL en ~5 minutos.
 *
 * DIFERENCIA con chaos_injection.js:
 *   El script de caos general usaba hasta 1500 VUs que mataban el servidor
 *   instantáneamente → timeouts → el agente reportaba ceros → el modelo
 *   interpretaba "servidor idle" en lugar de "servidor colapsando".
 *
 *   Este script usa una carga PROGRESIVA que degrada sin matar:
 *     - El servidor sigue respondiendo (con latencia alta)
 *     - El leak bucket sube constantemente
 *     - El event loop lag escala gradualmente
 *     - El telemetry agent obtiene valores reales, no ceros por timeout
 *
 * Con DEMO_MODE=true y CRITICAL_IMMEDIATE_TTF_MINUTES=3.0:
 *   El sistema debería entrar en CRITICAL cuando TTF caiga a <3min.
 */

import http      from 'k6/http';
import { sleep } from 'k6';
import { check } from 'k6';

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3001';

export const options = {
  stages: [
    // Fase 1 (0-1min): Carga base — el sistema empieza a calentarse
    { duration: '1m',  target: 15  },
    // Fase 2 (1-3min): Escalada progresiva — el leak bucket sube visiblemente
    { duration: '2m',  target: 40  },
    // Fase 3 (3-5min): Presión sostenida — latencia sube, event loop saturado
    { duration: '2m',  target: 60  },
    // Fase 4 (5-7min): Pico crítico — el modelo debería predecir CRITICAL
    { duration: '2m',  target: 80  },
    // Fase 5 (7-8min): Mantener para que el jurado vea el Runbook
    { duration: '1m',  target: 80  },
  ],
  // Sin thresholds de aborto — queremos que corra completo para la demo
  thresholds: {},
};

export default function () {
  const res = http.get(`${BASE_URL}/api/status`, {
    timeout: '8s',
    tags:    { scenario: 'demo_attack' },
  });

  check(res, {
    'servidor responde': (r) => r.status !== 0,
  });

  // Sleep corto — queremos alta frecuencia de requests para acumular el leak
  sleep(0.2 + Math.random() * 0.3);
}