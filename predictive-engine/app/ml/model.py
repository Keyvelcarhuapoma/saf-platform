from __future__ import annotations

import numpy as np
import pandas as pd
from typing import Tuple, Optional, List, Dict, Any

import xgboost as xgb
from sklearn.preprocessing import StandardScaler

from app.ml.features import FEATURE_NAMES, compute_features
from app.core.logger import get_logger

logger = get_logger(__name__)

_FLOOR_HEAP_MB:   float = 80.0
_FLOOR_LAG_MS:    float = 200.0
_FLOOR_DELAY_MS:  float = 1500.0
_ADAPTIVE_SIGMA:  float = 2.0
_MIN_SAMPLES_FOR_TRAIN: int = 30


def _compute_adaptive_thresholds(df: pd.DataFrame) -> Dict[str, float]:
    thresholds = {}

    for col, floor, key in [
        ("target_heap_used_mb",       _FLOOR_HEAP_MB,   "heap_mb"),
        ("target_event_loop_lag_ms",  _FLOOR_LAG_MS,    "lag_ms"),
        ("target_network_delay_ms",   _FLOOR_DELAY_MS,  "delay_ms"),
    ]:
        if col in df.columns:
            vals = df[col].dropna()
            if len(vals) >= 5:
                adaptive = vals.mean() + _ADAPTIVE_SIGMA * vals.std()
                thresholds[key] = max(floor, float(adaptive))
            else:
                thresholds[key] = floor
        else:
            thresholds[key] = floor

    logger.debug(
        f"Umbrales adaptativos | "
        f"heap: {thresholds['heap_mb']:.1f}MB | "
        f"lag: {thresholds['lag_ms']:.1f}ms | "
        f"delay: {thresholds['delay_ms']:.1f}ms"
    )
    return thresholds


class SAFPredictor:

    def __init__(self) -> None:
        self._model:            Optional[xgb.XGBRegressor] = None
        self._scaler:           Optional[StandardScaler]   = None
        self._is_fitted:        bool                       = False
        self._training_samples: int                        = 0
        self._last_thresholds:  Dict[str, float]           = {}

    @property
    def is_fitted(self) -> bool:
        return self._is_fitted

    def fit(self, records: List[Dict[str, Any]]) -> bool:
        if len(records) < _MIN_SAMPLES_FOR_TRAIN:
            logger.warning(f"Datos insuficientes: {len(records)}/{_MIN_SAMPLES_FOR_TRAIN}")
            return False

        df = pd.DataFrame(records)

        for col in ["target_heap_used_mb", "target_event_loop_lag_ms",
                    "target_network_delay_ms", "target_leak_bucket_mb", "cpu_percent"]:
            if col not in df.columns:
                df[col] = 0.0

        df = df.ffill(limit=3).fillna(0.0)

        thresholds = _compute_adaptive_thresholds(df)
        self._last_thresholds = thresholds

        collapse_mask = (
            (df["target_heap_used_mb"]      > thresholds["heap_mb"])  |
            (df["target_event_loop_lag_ms"] > thresholds["lag_ms"])   |
            (df["target_network_delay_ms"]  > thresholds["delay_ms"])
        )

        collapse_indices = df.index[collapse_mask].tolist()

        if not collapse_indices:
            # FIX CRÍTICO: multiplicador 1.5 → 8.0
            # Con 60 puntos: TTF proyectado = 480 puntos × 5s / 60 = 40 minutos → HEALTHY
            # Con 1.5 era 2.5 minutos → falso DEGRADING inmediato al salir de calibración
            collapse_idx = len(df) + int(len(df) * 8.0)
            logger.info(
                f"Sin colapso real detectado — proyección conservadora en idx={collapse_idx} "
                f"(~{int(len(df) * 8.0 * 5 / 60)}min)"
            )
        else:
            collapse_idx = collapse_indices[0]
            logger.debug(f"Colapso detectado en idx={collapse_idx}")

        X_list: List[np.ndarray] = []
        y_list:  List[float]     = []
        window_size = 6

        for i in range(window_size, len(df)):
            window_records = df.iloc[i - window_size:i].to_dict("records")
            try:
                feature_vec, _ = compute_features(window_records)
            except Exception:
                continue

            points_to_collapse = max(0, collapse_idx - i)
            ttf_minutes        = points_to_collapse * 5.0 / 60.0
            X_list.append(feature_vec[0])
            y_list.append(ttf_minutes)

        if len(X_list) < 10:
            logger.warning("Ventanas insuficientes para entrenar")
            return False

        X = np.array(X_list, dtype=np.float64)
        y = np.array(y_list, dtype=np.float64)

        self._scaler = StandardScaler()
        X_scaled = self._scaler.fit_transform(X)

        self._model = xgb.XGBRegressor(
            n_estimators=200,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_weight=3,
            objective="reg:squarederror",
            random_state=42,
            n_jobs=-1,
            verbosity=0,
        )
        self._model.fit(X_scaled, y, eval_set=[(X_scaled, y)], verbose=False)
        self._is_fitted        = True
        self._training_samples = len(X_list)

        logger.info(
            f"Modelo entrenado | muestras: {self._training_samples} | "
            f"colapso_idx: {collapse_idx} | "
            f"umbral_heap: {thresholds['heap_mb']:.1f}MB"
        )
        return True

    def predict(self, records: List[Dict[str, Any]]) -> Tuple[float, float, "FeatureSnapshot"]:
        if not self._is_fitted:
            raise RuntimeError("Modelo no entrenado. Llamar fit() primero.")

        feature_vec, snapshot = compute_features(records)
        feature_scaled        = self._scaler.transform(feature_vec)
        ttf_raw               = float(self._model.predict(feature_scaled)[0])
        ttf_minutes           = max(0.0, min(ttf_raw, 120.0))

        # Confidence via convergencia de 3 checkpoints del ensemble
        try:
            n       = self._model.n_estimators
            dm      = xgb.DMatrix(
                feature_scaled,
                feature_names=[f"f{i}" for i in range(feature_scaled.shape[1])]
            )
            booster = self._model.get_booster()

            p_half    = float(booster.predict(dm, iteration_range=(0, max(1, n // 2)))[0])
            p_three_q = float(booster.predict(dm, iteration_range=(0, max(1, int(n * 0.75))))[0])
            p_full    = float(self._model.predict(feature_scaled)[0])

            avg_pred = (p_half + p_three_q + p_full) / 3
            rng_pred = max(p_half, p_three_q, p_full) - min(p_half, p_three_q, p_full)

            if avg_pred > 0.1:
                cv         = rng_pred / avg_pred
                confidence = float(max(0.10, min(0.95, 0.95 - cv * 0.85)))
            else:
                confidence = 0.85

        except Exception as exc:
            logger.debug(f"Confidence fallback: {exc}")
            confidence = 0.5

        return ttf_minutes, confidence, snapshot


predictor = SAFPredictor()