"""
Router de la API predictiva v1.

Endpoints:
  GET /api/v1/predict/ttf  — predicción de Time To Failure
  GET /health              — estado del motor predictivo
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status

from app.schemas.prediction import (
    PredictionResponse,
    HealthResponse,
    SystemStatus,
)
from app.services.prediction_store import prediction_store
from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

router = APIRouter()


@router.get(
    "/api/v1/predict/ttf",
    response_model=PredictionResponse,
    summary="Time To Failure prediction",
    description=(
        "Retorna la predicción actual de Time To Failure del servidor objetivo. "
        "La predicción es calculada por el inference loop en background cada "
        f"{settings.inference_interval_sec} segundos. "
        "Este endpoint simplemente lee el último resultado en O(1) — "
        "sin I/O, sin cómputo ML en el request path."
    ),
    responses={
        200: {"description": "Predicción disponible"},
        503: {"description": "Motor predictivo sin datos suficientes todavía"},
    },
)
async def get_time_to_failure() -> PredictionResponse:
    """
    Endpoint principal del motor predictivo.

    Latencia garantizada: <1ms (solo lectura del PredictionStore en memoria).
    No hace I/O de red, no ejecuta el modelo ML, no bloquea el event loop.
    """
    prediction = await prediction_store.get()

    if prediction is None:
        # El inference loop aún no ha completado su primer ciclo
        # Retornamos 503 con un cuerpo descriptivo en lugar de crashear
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error":   "INSUFFICIENT_DATA",
                "message": (
                    f"El motor predictivo está inicializando. "
                    f"Se necesitan al menos {settings.min_data_points} puntos "
                    f"de datos en InfluxDB. "
                    f"Reintenta en {settings.inference_interval_sec} segundos."
                ),
                "retry_after_seconds": settings.inference_interval_sec,
            },
        )

    logger.debug(f"Predicción servida desde store | status: {prediction.system_status}")
    return prediction


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Estado del motor predictivo",
)
async def health_check() -> HealthResponse:
    """
    Healthcheck del motor predictivo.
    Incluye el estado del inference loop y la última predicción.
    """
    prediction = await prediction_store.get()

    return HealthResponse(
        status="healthy" if prediction is not None else "initializing",
        inference_loop_active=True,
        last_prediction_at=prediction_store.last_prediction_at,
        data_points_cached=prediction_store.data_points_cached,
        uptime_seconds=round(prediction_store.uptime_seconds, 2),
    )