'use client'

import { useDashboardStore } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * Gauge de Confidence Score.
 * Solo visible en estados DEGRADING y CRITICAL — en HEALTHY
 * mostrar un score del modelo añade ruido cognitivo innecesario.
 */
export function ConfidenceGauge() {
  const status     = useDashboardStore(s => s.prediction?.system_status ?? 'UNKNOWN')
  const confidence = useDashboardStore(s => s.prediction?.confidence_score ?? null)

  // Mostramos el nivel de confianza siempre que exista predicción activa
  if (status === 'UNKNOWN' || confidence === null) {
    return null
  }

  const percentage = Math.round(confidence * 100)

  // Color de la barra según el nivel de confianza
  const barColor = percentage >= 75
    ? 'bg-emerald-500'
    : percentage >= 50
      ? 'bg-amber-500'
      : 'bg-red-500'

  return (
    <div className="w-full max-w-sm space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-xs text-zinc-500 font-mono uppercase tracking-wider">
          Confianza del modelo
        </span>
        <span className={cn(
          'text-sm font-mono font-semibold',
          percentage >= 75 ? 'text-emerald-400' :
          percentage >= 50 ? 'text-amber-400'   : 'text-red-400'
        )}>
          {percentage}%
        </span>
      </div>
      {/* Barra de progreso */}
      <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-700', barColor)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}