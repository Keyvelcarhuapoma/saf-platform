"""
S.A.F. — Predictive Engine
Punto de entrada principal de FastAPI.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import List, Dict, Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.api.v1.predict import router
from app.core.config import settings
from app.core.logger import get_logger
from app.ml.model import predictor
from app.services.influx_client import fetch_metrics_window
from app.services.prediction_store import prediction_store
from app.schemas.prediction import PredictionResponse, SystemStatus

logger = get_logger(__name__)

_scheduler = AsyncIOScheduler(timezone="UTC")


async def _run_inference_cycle() -> None:
    """
    Ciclo completo del inference loop.

    Tres fases de operación:
      FASE 0 — Sin datos (< MIN_DATA_POINTS):
        No hay suficientes puntos ni para calibrar. Estado UNKNOWN.

      FASE 1 — Calibración (MIN_DATA_POINTS ≤ puntos < WARMUP_DATA_POINTS):
        El modelo aún no tiene baseline confiable. Estado CALIBRATING.
        Se muestra el progreso de recolección. No se emiten alertas.

      FASE 2 — Operacional (puntos ≥ WARMUP_DATA_POINTS):
        Predicciones completas con confidence dinámico.
    """
    logger.debug("Iniciando ciclo de inferencia")

    # ── Extracción asíncrona ───────────────────────────────────────────────────
    try:
        records: List[Dict[str, Any]] = await fetch_metrics_window()
    except Exception as exc:
        logger.error(f"Error extrayendo datos de InfluxDB: {exc} — manteniendo último estado")
        return

    prediction_store.set_data_points_cached(len(records))

    # ── FASE 0: Sin datos suficientes para nada ────────────────────────────────
    if len(records) < settings.min_data_points:
        logger.warning(
            f"Datos insuficientes: {len(records)}/{settings.min_data_points} puntos"
        )
        await prediction_store.update(PredictionResponse(
            time_to_failure_minutes=None,
            confidence_score=None,
            system_status=SystemStatus.UNKNOWN,
            predicted_at=datetime.now(timezone.utc),
            data_points_used=len(records),
            query_window_min=settings.query_window_minutes,
            calibration_progress=None,
        ))
        return

    # ── FASE 1: Calibración — warm-up, sin alertas ────────────────────────────
    # Durante esta fase el modelo no tiene suficiente baseline para distinguir
    # comportamiento normal de anomalía. Emitir DEGRADING aquí es un falso positivo.
    if len(records) < settings.warmup_data_points:
        progress = round(len(records) / settings.warmup_data_points, 3)
        logger.info(
            f"Calibrando: {len(records)}/{settings.warmup_data_points} puntos "
            f"({progress*100:.0f}%)"
        )
        await prediction_store.update(PredictionResponse(
            time_to_failure_minutes=None,
            confidence_score=progress,   # Reusamos este campo como progreso de calibración
            system_status=SystemStatus.CALIBRATING,
            predicted_at=datetime.now(timezone.utc),
            data_points_used=len(records),
            query_window_min=settings.query_window_minutes,
            calibration_progress=progress,
        ))
        return

    # ── FASE 2: Operacional — entrenamiento + predicción ──────────────────────
    # Reentrenamos periódicamente para adaptarnos al comportamiento actual
    if not predictor.is_fitted or len(records) % 50 == 0:
        fit_success = predictor.fit(records)
        if not fit_success:
            logger.warning("Entrenamiento fallido — datos insuficientes para etiquetas TTF")
            return

    try:
        ttf_minutes, base_confidence, feature_snapshot = predictor.predict(records)
    except Exception as exc:
        logger.error(f"Error en predicción XGBoost: {exc}")
        return

    # ── Confidence dinámico — tres factores combinados ────────────────────────
    #
    # Factor 1: Madurez de datos (data_maturity)
    #   0.0 justo al salir del warm-up → 1.0 con el doble de puntos del warm-up
    #   Previene alta confianza cuando el modelo acaba de ver suficientes datos
    data_maturity = min(1.0, (len(records) - settings.warmup_data_points) /
                              settings.warmup_data_points)

    # Factor 2: Certeza temporal (ttf_certainty)
    #   TTF cercano → alta certeza (colapso inminente es predecible)
    #   TTF lejano → baja certeza (el futuro distante tiene más incertidumbre)
    #   Normalizado: TTF=0min → 1.0, TTF=30min → 0.5, TTF=60min → 0.0
    ttf_certainty = max(0.0, 1.0 - (ttf_minutes / 60.0))

    # Combinación ponderada: modelo 50%, madurez 30%, certeza temporal 20%
    confidence = (base_confidence * 0.50 +
                  data_maturity   * 0.30 +
                  ttf_certainty   * 0.20)
    confidence = round(max(0.15, min(0.95, confidence)), 4)

    # ── Determinación del estado ───────────────────────────────────────────────
    # CRITICAL_IMMEDIATE_TTF_MINUTES configurable (default 3.0, era 0.5 hardcodeado)
    # Este era el bug principal que impedía que CRITICAL se disparara
    if ttf_minutes <= settings.critical_immediate_ttf_minutes:
        system_status = SystemStatus.CRITICAL
    elif ttf_minutes <= settings.critical_ttf_threshold_minutes:
        system_status = SystemStatus.DEGRADING
    else:
        system_status = SystemStatus.HEALTHY

    prediction = PredictionResponse(
        time_to_failure_minutes=round(ttf_minutes, 2),
        confidence_score=confidence,
        system_status=system_status,
        predicted_at=datetime.now(timezone.utc),
        data_points_used=len(records),
        query_window_min=settings.query_window_minutes,
        calibration_progress=None,
        features=feature_snapshot,
    )

    await prediction_store.update(prediction)

    logger.info(
        f"Ciclo completado | TTF: {ttf_minutes:.1f}min | "
        f"status: {system_status} | confidence: {confidence:.2f} | "
        f"puntos: {len(records)}"
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("S.A.F. Predictive Engine arrancando")
    logger.info(
        f"Config | ventana: {settings.query_window_minutes}min | "
        f"warmup: {settings.warmup_data_points}pts | "
        f"critical_ttf: <{settings.critical_immediate_ttf_minutes}min | "
        f"demo_mode: {settings.demo_mode}"
    )

    _scheduler.add_job(
        _run_inference_cycle,
        trigger="interval",
        seconds=settings.inference_interval_sec,
        id="inference_loop",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    logger.info(f"Inference loop iniciado — cada {settings.inference_interval_sec}s")

    await _run_inference_cycle()

    yield

    _scheduler.shutdown(wait=False)
    logger.info("S.A.F. Predictive Engine detenido")


app = FastAPI(
    title="S.A.F. Predictive Engine",
    description="Motor AIOps predictivo del Sistema de Anticipación de Fallos.",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3005", "http://127.0.0.1:3005"],
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["Accept", "Content-Type"],
    max_age=86400,
)

app.include_router(router)