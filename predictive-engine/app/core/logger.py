"""
Logger estructurado del Predictive Engine.

Usa el módulo logging estándar de Python con formato JSON
para consistencia con los logs del Telemetry Agent en Go.
"""

import logging
import json
import sys
from datetime import datetime, timezone


class JSONFormatter(logging.Formatter):
    """Formateador que emite cada línea de log como un objeto JSON."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "time":    datetime.now(timezone.utc).isoformat(),
            "level":   record.levelname,
            "service": "saf-predictive-engine",
            "msg":     record.getMessage(),
        }
        # Incluimos información de excepción si existe
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_entry)


def get_logger(name: str) -> logging.Logger:
    """
    Retorna un logger configurado con formato JSON.
    Llamar con __name__ en cada módulo para trazabilidad.
    """
    logger = logging.getLogger(name)

    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JSONFormatter())
        logger.addHandler(handler)
        logger.propagate = False

    return logger