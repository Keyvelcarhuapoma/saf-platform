from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum
from typing import Optional


class SystemStatus(str, Enum):
    HEALTHY     = "HEALTHY"
    CALIBRATING = "CALIBRATING"  # Fase de warm-up — sin predicciones confiables todavía
    DEGRADING   = "DEGRADING"
    CRITICAL    = "CRITICAL"
    UNKNOWN     = "UNKNOWN"


class FeatureSnapshot(BaseModel):
    cpu_percent_mean:          float
    cpu_percent_slope:         float
    heap_used_mb_mean:         float
    heap_used_mb_slope:        float
    event_loop_lag_ms_mean:    float
    event_loop_lag_ms_slope:   float
    network_delay_ms_mean:     float
    network_delay_ms_slope:    float
    leak_bucket_mb_mean:       float
    leak_bucket_mb_slope:      float


class PredictionResponse(BaseModel):
    model_config = {"protected_namespaces": ()}

    time_to_failure_minutes:  Optional[float] = Field(default=None, ge=0)
    confidence_score:         Optional[float] = Field(default=None, ge=0.0, le=1.0)
    system_status:            SystemStatus
    predicted_at:             datetime
    data_points_used:         int
    query_window_min:         int
    # Durante CALIBRATING: porcentaje de progreso del warm-up (0.0 a 1.0)
    # El frontend usa este valor para renderizar la barra de calibración
    calibration_progress:     Optional[float] = Field(default=None, ge=0.0, le=1.0)
    features:                 Optional[FeatureSnapshot] = None
    model_version:            str   = Field(default="xgboost-v1.0")
    engine_version:           str   = Field(default="2.0.0")


class HealthResponse(BaseModel):
    status:                str
    inference_loop_active: bool
    last_prediction_at:    Optional[datetime]
    data_points_cached:    int
    uptime_seconds:        float