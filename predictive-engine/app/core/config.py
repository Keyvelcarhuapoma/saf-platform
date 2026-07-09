from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    # ── InfluxDB ──────────────────────────────────────────────────────────────
    influx_url:    str = Field(default="http://localhost:8086", alias="INFLUX_URL")
    influx_token:  str = Field(default="saf_demo_token_12345", alias="INFLUX_TOKEN")
    influx_org:    str = Field(default="saf_org", alias="INFLUX_ORG")
    influx_bucket: str = Field(default="saf_telemetry", alias="INFLUX_BUCKET")

    # ── Motor Predictivo ──────────────────────────────────────────────────────
    query_window_minutes:   int   = Field(default=15,   alias="QUERY_WINDOW_MINUTES")
    min_data_points:        int   = Field(default=20,   alias="MIN_DATA_POINTS")
    # Puntos mínimos para salir de la fase de calibración y hacer predicciones reales
    # Por debajo de este umbral el sistema muestra CALIBRATING, no DEGRADING/CRITICAL
    warmup_data_points:     int   = Field(default=60,   alias="WARMUP_DATA_POINTS")
    inference_interval_sec: int   = Field(default=15,   alias="INFERENCE_INTERVAL_SEC")

    # Umbral de TTF para escalar a CRITICAL (era hardcodeado en 0.5 — el bug principal)
    # Con DEMO_MODE: 3.0 min → cualquier TTF < 3min dispara CRITICAL
    critical_immediate_ttf_minutes: float = Field(default=3.0,  alias="CRITICAL_IMMEDIATE_TTF_MINUTES")
    critical_ttf_threshold_minutes: int   = Field(default=20,   alias="CRITICAL_TTF_THRESHOLD_MINUTES")

    # ── Demo Mode ─────────────────────────────────────────────────────────────
    demo_mode: bool = Field(default=False, alias="DEMO_MODE")

    # ── API ───────────────────────────────────────────────────────────────────
    api_host:  str = Field(default="0.0.0.0", alias="API_HOST")
    api_port:  int = Field(default=8000,      alias="API_PORT")
    log_level: str = Field(default="info",    alias="LOG_LEVEL")

    model_config = {"populate_by_name": True, "env_file": ".env", "extra": "ignore"}


settings = Settings()              