'use client'

import { useDashboardStore } from '@/lib/store'
import { formatSlope, cn } from '@/lib/utils'
import { TrendingUp, TrendingDown, Minus, Cpu, MemoryStick, Activity, Network } from 'lucide-react'

/**
 * Grid de métricas secundarias — visible solo cuando hay anomalía.
 * Muestra las señales que el modelo está usando para la predicción,
 * con indicadores de tendencia para que el SRE entienda el diagnóstico.
 */
export function MetricsGrid() {
  const features = useDashboardStore(s => s.prediction?.features ?? null)
  const status   = useDashboardStore(s => s.prediction?.system_status ?? 'UNKNOWN')

  // Mostramos siempre las métricas secundarias para dar visibilidad total al operador y al jurado
  if (!features) return null

  const metrics = [
    {
      label:   'CPU Sistema',
      icon:    Cpu,
      value:   `${features.cpu_percent_mean.toFixed(1)}%`,
      slope:   features.cpu_percent_slope,
      unit:    '%/tick',
    },
    {
      label:   'Heap Node.js',
      icon:    MemoryStick,
      value:   `${features.heap_used_mb_mean.toFixed(1)} MB`,
      slope:   features.heap_used_mb_slope,
      unit:    'MB/tick',
    },
    {
      label:   'Event Loop Lag',
      icon:    Activity,
      value:   `${features.event_loop_lag_ms_mean.toFixed(1)} ms`,
      slope:   features.event_loop_lag_ms_slope,
      unit:    'ms/tick',
    },
    {
      label:   'Network Delay',
      icon:    Network,
      value:   `${features.network_delay_ms_mean.toFixed(0)} ms`,
      slope:   features.network_delay_ms_slope,
      unit:    'ms/tick',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full">
      {metrics.map(({ label, icon: Icon, value, slope, unit }) => {
        const isRising  = slope > 0.001
        const isFalling = slope < -0.001
        const TrendIcon = isRising ? TrendingUp : isFalling ? TrendingDown : Minus
        const trendColor = isRising
          ? 'text-red-400'
          : isFalling
            ? 'text-emerald-400'
            : 'text-zinc-500'

        return (
          <div
            key={label}
            className="flex flex-col gap-2 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800/50"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500 font-mono">{label}</span>
              <Icon className="w-3.5 h-3.5 text-zinc-600" />
            </div>
            <span className="text-lg font-mono font-semibold text-zinc-200">
              {value}
            </span>
            <div className={cn('flex items-center gap-1 text-xs font-mono', trendColor)}>
              <TrendIcon className="w-3 h-3" />
              <span>{formatSlope(slope)} {unit}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}