"""
PredictionStore — Estado compartido del motor predictivo.

FLUJO DE DEMO SIMPLIFICADO:
  UNKNOWN → CALIBRATING → HEALTHY → DEGRADING

  CRITICAL queda en el código pero se trata igual que DEGRADING
  desde el frontend — esta decisión permite restaurarlo fácilmente
  post-demo sin cambiar arquitectura.

ANTI-FALSOS-POSITIVOS:
  - DEGRADING requiere 2 ciclos consecutivos (30s con intervalo de 15s)
    Previene que un spike aislado al salir de calibración dispare la alerta
  - CRITICAL sigue requiriendo 3 ciclos (preservado para producción futura)
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Optional

from app.schemas.prediction import PredictionResponse, SystemStatus
from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)

# ── Parámetros de debouncing ──────────────────────────────────────────────────
# DEGRADING: 2 ciclos = 30s de confirmación antes de alertar
DEGRADING_CONFIRMATION_CYCLES: int  = 2
# CRITICAL: 1 ciclo en demo_mode, 3 en producción
CRITICAL_CONFIRMATION_CYCLES:  int  = 1 if settings.demo_mode else 3
COOLDOWN_AFTER_CRITICAL_SEC:   int  = 30 if settings.demo_mode else 120
MIN_CONFIDENCE_FOR_CRITICAL:   float = 0.35 if settings.demo_mode else 0.55


class PredictionStore:

    def __init__(self) -> None:
        self._lock:            asyncio.Lock                  = asyncio.Lock()
        self._last_prediction: Optional[PredictionResponse]  = None
        self._started_at:      datetime                      = datetime.now(timezone.utc)
        self._data_points_cached: int                        = 0

        # Contadores de debouncing
        self._consecutive_degrading_cycles: int              = 0
        self._consecutive_critical_cycles:  int              = 0
        self._last_confirmed_critical_at: Optional[datetime] = None
        self._in_cooldown: bool                              = False
        self._healthy_streak: int                            = 0

    async def update(self, prediction: PredictionResponse) -> None:
        async with self._lock:
            sanitized = self._apply_mitigation(prediction)
            self._last_prediction = sanitized

        confidence_str = (
            f"{sanitized.confidence_score:.2f}"
            if sanitized.confidence_score is not None else "N/A"
        )
        ttf_str = (
            f"{sanitized.time_to_failure_minutes:.2f}"
            if sanitized.time_to_failure_minutes is not None else "N/A"
        )
        logger.debug(
            f"Store actualizado | "
            f"ttf: {ttf_str}min | "
            f"raw: {prediction.system_status} → final: {sanitized.system_status} | "
            f"conf: {confidence_str} | "
            f"streak_deg: {self._consecutive_degrading_cycles} | "
            f"streak_crit: {self._consecutive_critical_cycles}"
        )

    def _apply_mitigation(self, prediction: PredictionResponse) -> PredictionResponse:
        """
        Aplica debouncing en cascada:
          1. DEGRADING requiere 2 ciclos consecutivos
          2. CRITICAL requiere N ciclos consecutivos (después de pasar por DEGRADING)
          3. Cooldown post-CRITICAL
          4. Confidence guard para CRITICAL
        """
        final_status = prediction.system_status
        now          = datetime.now(timezone.utc)

        # Estados que no aplican mitigation
        if final_status in (SystemStatus.UNKNOWN, SystemStatus.CALIBRATING):
            self._reset_all_streaks()
            return prediction

        # ── Confidence guard ──────────────────────────────────────────────────
        if (final_status == SystemStatus.CRITICAL
                and prediction.confidence_score is not None
                and prediction.confidence_score < MIN_CONFIDENCE_FOR_CRITICAL):
            final_status = SystemStatus.DEGRADING

        # ── Cooldown post-CRITICAL ────────────────────────────────────────────
        if self._in_cooldown and self._last_confirmed_critical_at:
            elapsed = (now - self._last_confirmed_critical_at).total_seconds()
            if elapsed >= COOLDOWN_AFTER_CRITICAL_SEC:
                self._in_cooldown = False
                self._consecutive_critical_cycles = 0
            elif final_status == SystemStatus.CRITICAL:
                final_status = SystemStatus.DEGRADING

        # ── Debouncing DEGRADING (nuevo — el fix del falso positivo) ─────────
        if final_status == SystemStatus.DEGRADING:
            self._consecutive_degrading_cycles += 1
            self._consecutive_critical_cycles   = 0  # Reset critical streak

            if self._consecutive_degrading_cycles < DEGRADING_CONFIRMATION_CYCLES:
                logger.debug(
                    f"DEGRADING pendiente: ciclo "
                    f"{self._consecutive_degrading_cycles}/{DEGRADING_CONFIRMATION_CYCLES}"
                )
                # Mientras no se confirma, reportamos el último estado estable
                # En lugar de emitir HEALTHY falso, emitimos UNKNOWN temporal
                # para que el frontend mantenga el último estado conocido
                final_status = SystemStatus.HEALTHY
            else:
                self._healthy_streak = 0

        # ── Debouncing CRITICAL ───────────────────────────────────────────────
        elif final_status == SystemStatus.CRITICAL:
            self._consecutive_critical_cycles += 1
            self._consecutive_degrading_cycles = 0

            if self._consecutive_critical_cycles < CRITICAL_CONFIRMATION_CYCLES:
                final_status = SystemStatus.DEGRADING
            else:
                if not self._in_cooldown:
                    self._last_confirmed_critical_at = now
                    self._in_cooldown                = True
                    logger.warning(
                        f"CRITICAL confirmado tras {self._consecutive_critical_cycles} ciclos"
                    )

        # ── HEALTHY — reseteo de streaks ──────────────────────────────────────
        elif final_status == SystemStatus.HEALTHY:
            if self._consecutive_degrading_cycles > 0 or self._consecutive_critical_cycles > 0:
                logger.debug(
                    f"Recuperación | streak_deg: {self._consecutive_degrading_cycles} | "
                    f"streak_crit: {self._consecutive_critical_cycles}"
                )
            self._consecutive_degrading_cycles = 0
            self._consecutive_critical_cycles  = 0
            self._healthy_streak += 1

            # Recuperación confirmada: limpieza completa del estado
            if self._healthy_streak >= 8:
                self._in_cooldown                    = False
                self._last_confirmed_critical_at     = None
                self._healthy_streak                 = 0

        return prediction.model_copy(update={"system_status": final_status})

    def _reset_all_streaks(self) -> None:
        self._consecutive_degrading_cycles = 0
        self._consecutive_critical_cycles  = 0
        self._healthy_streak               = 0

    async def get(self) -> Optional[PredictionResponse]:
        async with self._lock:
            return self._last_prediction

    def set_data_points_cached(self, count: int) -> None:
        self._data_points_cached = count

    @property
    def is_in_cooldown(self) -> bool:
        return self._in_cooldown

    @property
    def uptime_seconds(self) -> float:
        return (datetime.now(timezone.utc) - self._started_at).total_seconds()

    @property
    def data_points_cached(self) -> int:
        return self._data_points_cached

    @property
    def last_prediction_at(self) -> Optional[datetime]:
        if self._last_prediction:
            return self._last_prediction.predicted_at
        return None


prediction_store = PredictionStore()