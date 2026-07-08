export type SystemStatus = 'HEALTHY' | 'CALIBRATING' | 'DEGRADING' | 'CRITICAL' | 'UNKNOWN'

export interface FeatureSnapshot {
  cpu_percent_mean:          number
  cpu_percent_slope:         number
  heap_used_mb_mean:         number
  heap_used_mb_slope:        number
  event_loop_lag_ms_mean:    number
  event_loop_lag_ms_slope:   number
  network_delay_ms_mean:     number
  network_delay_ms_slope:    number
  leak_bucket_mb_mean:       number
  leak_bucket_mb_slope:      number
}

export interface PredictionResponse {
  time_to_failure_minutes:  number | null
  confidence_score:         number | null
  system_status:            SystemStatus
  predicted_at:             string
  data_points_used:         number
  query_window_min:         number
  calibration_progress:     number | null
  features:                 FeatureSnapshot | null
  model_version:            string
  engine_version:           string
}

export interface DashboardState {
  prediction:       PredictionResponse | null
  isLoading:        boolean
  isConnected:      boolean
  lastUpdatedAt:    Date | null
  errorCount:       number
  isRunbookOpen:    boolean
  isAcknowledged:   boolean
  acknowledgedAt:   Date | null
}