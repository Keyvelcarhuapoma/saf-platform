"""
Módulo de Feature Engineering on-the-fly.

Toma las series temporales crudas de InfluxDB y calcula los features
que XGBoost necesita para predecir el Time To Failure.

FILOSOFÍA DEL FEATURE ENGINEERING:
  Los valores absolutos (ej: heap=45MB) son menos informativos que
  la VELOCIDAD de cambio (ej: heap crece 2MB/s). Un servidor con
  heap en 45MB que ESTÁ SUBIENDO es más peligroso que uno con
  heap en 80MB que está ESTABLE.

  Por eso calculamos dos tipos de features por cada métrica:
    1. Estadísticas de ventana (mean, max, std) — el estado actual
    2. Slope (pendiente de regresión lineal) — la velocidad de cambio

  El slope es la derivada temporal discreta de la serie:
    slope = Δmetrica / Δtiempo
  Calculado via regresión lineal de mínimos cuadrados sobre la ventana
  completa — más robusto que el delta punto a punto (menos sensible al ruido).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from typing import List, Dict, Any, Tuple

from app.schemas.prediction import FeatureSnapshot
from app.core.logger import get_logger

logger = get_logger(__name__)

# Columnas de métricas que esperamos del cliente InfluxDB
_REQUIRED_COLUMNS = [
    "cpu_percent",
    "target_heap_used_mb",
    "target_leak_bucket_mb",
    "target_event_loop_lag_ms",
    "target_network_delay_ms",
]

# Nombres de los features en el orden exacto que XGBoost espera
# (debe coincidir con el orden usado durante el entrenamiento)
FEATURE_NAMES = [
    "cpu_percent_mean",
    "cpu_percent_slope",
    "cpu_percent_std",
    "heap_used_mb_mean",
    "heap_used_mb_slope",
    "heap_used_mb_std",
    "leak_bucket_mb_mean",
    "leak_bucket_mb_slope",
    "event_loop_lag_ms_mean",
    "event_loop_lag_ms_slope",
    "event_loop_lag_ms_max",
    "network_delay_ms_mean",
    "network_delay_ms_slope",
    "network_delay_ms_max",
    "heap_x_lag_interaction",   # Feature de interacción — detecta colapso combinado
    "leak_acceleration",        # Segunda derivada del leak — detecta aceleración
]


def _compute_slope(values: np.ndarray) -> float:
    """
    Calcula la pendiente de regresión lineal de mínimos cuadrados.
    Más robusto que el delta simple porque usa todos los puntos
    de la ventana, no solo el primero y el último.

    Retorna la pendiente en unidades/segundo normalizada por el
    número de puntos (para comparabilidad entre ventanas de distinto tamaño).
    """
    n = len(values)
    if n < 2:
        return 0.0

    # Eje X: índices de tiempo normalizados (0 a n-1)
    x = np.arange(n, dtype=np.float64)

    # Fórmula de mínimos cuadrados: slope = (n·Σxy - Σx·Σy) / (n·Σx² - (Σx)²)
    x_mean = x.mean()
    y_mean = values.mean()
    numerator   = np.sum((x - x_mean) * (values - y_mean))
    denominator = np.sum((x - x_mean) ** 2)

    if denominator == 0:
        return 0.0

    return float(numerator / denominator)


def compute_features(
    records: List[Dict[str, Any]]
) -> Tuple[np.ndarray, FeatureSnapshot]:
    """
    Convierte los registros crudos de InfluxDB en el vector de features
    que XGBoost necesita para hacer la predicción.

    Args:
        records: Lista de dicts con las métricas por timestamp

    Returns:
        Tuple de:
          - np.ndarray shape (1, len(FEATURE_NAMES)) — input para XGBoost
          - FeatureSnapshot — para incluir en la respuesta de la API

    Raises:
        ValueError: Si los datos son insuficientes o tienen demasiados NaN
    """
    # Convertimos a DataFrame para operaciones vectorizadas eficientes
    df = pd.DataFrame(records)

    # Rellenamos columnas faltantes con 0 para robustez
    # (el agente puede haber tenido gaps temporales)
    for col in _REQUIRED_COLUMNS:
        if col not in df.columns:
            logger.warning(f"Columna '{col}' ausente en los datos — rellenando con 0")
            df[col] = 0.0

    # Forward-fill para gaps pequeños (máximo 3 puntos consecutivos)
    df = df.ffill(limit=3).fillna(0.0)

# Límites realistas de cada métrica — rechazan valores corruptos por overflow
    # exponencial o errores de telemetría sin afectar señales legítimas de degradación
    _CEIL_CPU_PCT    = 100.0
    _CEIL_HEAP_MB    = 2_000.0   # 2GB — ningún Node.js de test supera esto
    _CEIL_LAG_MS     = 10_000.0  # 10s — lag > 10s = proceso zombie, no degradación
    _CEIL_DELAY_MS   = 8_000.0   # 8s — coincide con el cap de networkDelay.js
    _CEIL_LEAK_MB    = 2_000.0

    # Extraemos y clampeamos en un solo paso — zero allocations extras
    cpu       = np.clip(df["cpu_percent"].values.astype(np.float64),       0, _CEIL_CPU_PCT)
    heap      = np.clip(df["target_heap_used_mb"].values.astype(np.float64), 0, _CEIL_HEAP_MB)
    leak      = np.clip(df["target_leak_bucket_mb"].values.astype(np.float64), 0, _CEIL_LEAK_MB)
    lag       = np.clip(df["target_event_loop_lag_ms"].values.astype(np.float64), 0, _CEIL_LAG_MS)
    net_delay = np.clip(df["target_network_delay_ms"].values.astype(np.float64), 0, _CEIL_DELAY_MS)
    
    # ── Cálculo de slopes (velocidad de cambio) ───────────────────────────────
    cpu_slope   = _compute_slope(cpu)
    heap_slope  = _compute_slope(heap)
    leak_slope  = _compute_slope(leak)
    lag_slope   = _compute_slope(lag)
    delay_slope = _compute_slope(net_delay)

    # ── Feature de interacción: heap × event_loop_lag ─────────────────────────
    # Cuando ambos suben simultáneamente, el colapso es inminente.
    # El producto captura esta correlación que los features individuales no ven.
    heap_x_lag = float(heap.mean() * lag.mean()) / 1000.0  # Normalizado a ms·MB/1000

    # ── Segunda derivada del leak (aceleración) ────────────────────────────────
    # Si el leak no solo crece sino que ACELERA, el TTF se acorta exponencialmente.
    # Calculamos la slope de los slopes (derivada de la derivada).
    if len(leak) >= 4:
        mid   = len(leak) // 2
        slope_first_half  = _compute_slope(leak[:mid])
        slope_second_half = _compute_slope(leak[mid:])
        leak_acceleration = slope_second_half - slope_first_half
    else:
        leak_acceleration = 0.0

    # ── Vector de features en orden FEATURE_NAMES ────────────────────────────
    feature_vector = np.array([[
        cpu.mean(),
        cpu_slope,
        cpu.std() if len(cpu) > 1 else 0.0,
        heap.mean(),
        heap_slope,
        heap.std() if len(heap) > 1 else 0.0,
        leak.mean(),
        leak_slope,
        lag.mean(),
        lag_slope,
        lag.max(),
        net_delay.mean(),
        delay_slope,
        net_delay.max(),
        heap_x_lag,
        leak_acceleration,
    ]], dtype=np.float64)

    # Snapshot para la respuesta de la API
    snapshot = FeatureSnapshot(
        cpu_percent_mean=float(cpu.mean()),
        cpu_percent_slope=cpu_slope,
        heap_used_mb_mean=float(heap.mean()),
        heap_used_mb_slope=heap_slope,
        event_loop_lag_ms_mean=float(lag.mean()),
        event_loop_lag_ms_slope=lag_slope,
        network_delay_ms_mean=float(net_delay.mean()),
        network_delay_ms_slope=delay_slope,
        leak_bucket_mb_mean=float(leak.mean()),
        leak_bucket_mb_slope=leak_slope,
    )

    logger.debug(
        f"Features calculados | "
        f"heap_slope: {heap_slope:.4f} | "
        f"lag_slope: {lag_slope:.4f} | "
        f"leak_accel: {leak_acceleration:.4f}"
    )

    return feature_vector, snapshot