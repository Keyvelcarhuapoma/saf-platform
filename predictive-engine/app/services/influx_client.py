"""
Cliente asíncrono de InfluxDB para el Predictive Engine.

Usa influxdb-client-python con el modo async para no bloquear
el event loop de FastAPI/APScheduler durante las queries.

La query Flux extrae las últimas N minutos de todas las métricas
relevantes y las retorna como una lista de diccionarios planos,
listos para ser consumidos por el módulo de feature engineering.
"""

from __future__ import annotations

from typing import List, Dict, Any

from influxdb_client.client.influxdb_client_async import InfluxDBClientAsync

from app.core.config import settings
from app.core.logger import get_logger

logger = get_logger(__name__)


# Query Flux que extrae todas las métricas del Target Server
# en la ventana de tiempo especificada.
# Usamos pivot() para convertir las filas de series temporales
# en columnas — un registro por timestamp con todos los campos.
_METRICS_QUERY_TEMPLATE = """
from(bucket: "{bucket}")
  |> range(start: -{window}m)
  |> filter(fn: (r) => r._measurement == "system_metrics")
  |> filter(fn: (r) =>
      r._field == "cpu_percent" or
      r._field == "target_heap_used_mb" or
      r._field == "target_leak_bucket_mb" or
      r._field == "target_event_loop_lag_ms" or
      r._field == "target_network_delay_ms" or
      r._field == "target_request_duration_ms" or
      r._field == "mem_used_percent"
  )
  |> aggregateWindow(every: 5s, fn: mean, createEmpty: false)
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"], desc: false)
"""


async def fetch_metrics_window() -> List[Dict[str, Any]]:
    """
    Consulta asíncrona a InfluxDB que retorna la ventana de métricas
    configurada en settings.query_window_minutes.

    Retorna una lista de diccionarios donde cada elemento representa
    un punto en el tiempo con todos los campos como claves.

    Ejemplo de un elemento:
    {
        "_time": datetime(2026, 5, 3, 22, 40, 00),
        "cpu_percent": 12.5,
        "target_heap_used_mb": 45.2,
        "target_leak_bucket_mb": 19.8,
        "target_event_loop_lag_ms": 8.3,
        "target_network_delay_ms": 336.5,
        ...
    }

    Lanza InfluxQueryError si la query falla.
    Retorna lista vacía si no hay datos en la ventana.
    """
    query = _METRICS_QUERY_TEMPLATE.format(
        bucket=settings.influx_bucket,
        window=settings.query_window_minutes,
    )

    records: List[Dict[str, Any]] = []

    # Usamos async with para garantizar que la conexión se cierra
    # incluso si la query lanza una excepción
    async with InfluxDBClientAsync(
        url=settings.influx_url,
        token=settings.influx_token,
        org=settings.influx_org,
    ) as client:
        query_api = client.query_api()

        try:
            tables = await query_api.query(query=query, org=settings.influx_org)

            for table in tables:
                for record in table.records:
                    records.append(record.values)

            logger.debug(
                f"Query InfluxDB completada | "
                f"ventana: {settings.query_window_minutes}min | "
                f"registros: {len(records)}"
            )

        except Exception as exc:
            # Logueamos el error pero propagamos para que el inference loop
            # pueda manejarlo y mantener el último estado conocido
            logger.error(f"Error en query InfluxDB: {exc}")
            raise

    return records