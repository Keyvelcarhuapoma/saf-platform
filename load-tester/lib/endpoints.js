/**
 * S.A.F. — Load Tester
 * Módulo: Catálogo de Endpoints con Pesos de Selección
 *
 * Define todos los endpoints del Target Server y su probabilidad
 * de ser seleccionados en cada iteración de un Virtual User.
 *
 * Los pesos reflejan la distribución realista de tráfico de producción:
 * la mayoría de requests van al endpoint de negocio (/api/status),
 * una minoría son healthchecks de infraestructura (/health).
 */

// URL base del Target Server — configurable via variable de entorno de k6
export const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3001';

/**
 * Catálogo de endpoints con sus metadatos.
 * El campo `weight` es un peso relativo — no necesitan sumar 100.
 * La función weightedEndpoint() normaliza los pesos internamente.
 */
export const ENDPOINTS = [
  {
    name:        'status',
    path:        '/api/status',
    method:      'GET',
    weight:      85,   // 85% del tráfico — endpoint de negocio principal
    // Timeout generoso porque /api/status tiene degradación intencional
    timeout:     '10s',
    tags:        { endpoint: 'status', criticality: 'high' },
  },
  {
    name:        'health',
    path:        '/health',
    method:      'GET',
    weight:      15,   // 15% del tráfico — healthcheck de infraestructura
    timeout:     '3s', // Timeout estricto — /health debe ser siempre rápido
    tags:        { endpoint: 'health', criticality: 'low' },
  },
];

// Tabla de selección ponderada precalculada para O(1) lookup
// Construida una vez al cargar el módulo, no en cada iteración
const _cumulativeWeights = [];
let _totalWeight = 0;

for (const endpoint of ENDPOINTS) {
  _totalWeight += endpoint.weight;
  _cumulativeWeights.push(_totalWeight);
}

/**
 * Selecciona un endpoint aleatoriamente con distribución ponderada.
 * Algoritmo: búsqueda en tabla de pesos acumulados con un número aleatorio.
 *
 * Ejemplo con pesos [85, 15]:
 *   Acumulados: [85, 100]
 *   rand en [0, 100) → si rand < 85, retorna status; si no, retorna health
 *
 * @returns {Object} - Objeto endpoint del catálogo ENDPOINTS
 */
export function weightedEndpoint() {
  const rand = Math.random() * _totalWeight;
  for (let i = 0; i < _cumulativeWeights.length; i++) {
    if (rand < _cumulativeWeights[i]) {
      return ENDPOINTS[i];
    }
  }
  // Fallback defensivo — nunca debería llegar aquí
  return ENDPOINTS[ENDPOINTS.length - 1];
}

/**
 * Construye la URL completa para un endpoint dado.
 * @param {Object} endpoint - Objeto del catálogo ENDPOINTS
 * @returns {string}
 */
export function endpointURL(endpoint) {
  return `${BASE_URL}${endpoint.path}`;
}