'use client'

import { useDashboardStore } from '@/lib/store'
import { formatTTF, getStatusColor, cn } from '@/lib/utils'

export function TTFDisplay() {
  const ttf      = useDashboardStore(s => s.prediction?.time_to_failure_minutes ?? null)
  const status   = useDashboardStore(s => s.prediction?.system_status ?? 'UNKNOWN')
  const progress = useDashboardStore(s => s.prediction?.calibration_progress ?? null)
  const points   = useDashboardStore(s => s.prediction?.data_points_used ?? 0)
  const colors   = getStatusColor(status)

  const mainTarget = useDashboardStore(s => s.activeMainTarget)
  const isExternalTarget = mainTarget && !mainTarget.url.includes('localhost:3001')

  if (isExternalTarget) {
    const isErr = mainTarget.status === 'ERROR'
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-8">
        <p className="text-xs font-mono uppercase tracking-[0.3em] text-zinc-500">
          Estado del servidor principal seleccionado
        </p>
        <div className={cn(
          'font-mono font-black leading-none tracking-tight transition-colors duration-700 text-[72px] md:text-[110px] lg:text-[136px]',
          isErr ? 'text-red-500 animate-pulse' : 'text-emerald-400',
        )}>
          {isErr ? 'OFFLINE' : '> 24h'}
        </div>
        <p className={cn("text-sm font-mono text-center max-w-lg", isErr ? "text-red-400/90 font-semibold" : "text-zinc-500")}>
          {isErr
            ? `⚠️ El servidor principal (${mainTarget.name}) es inaccesible o no responde en la red.`
            : `🟢 Servidor externo operativo (${mainTarget.name}) — Latencia verificada: ${mainTarget.latency} ms.`}
        </p>
      </div>
    )
  }

  // Estado de calibración — no mostramos TTF sino progreso de recolección
  if (status === 'CALIBRATING' && progress !== null) {
    const pct = Math.round(progress * 100)
    // warmup_data_points está hardcodeado en 60 en el backend
    const total = 60
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-8 w-full max-w-md">
        <p className="text-xs font-mono uppercase tracking-[0.3em] text-zinc-500">
          Analizando comportamiento base
        </p>
        {/* Barra de progreso */}
        <div className="w-full space-y-2">
          <div className="flex justify-between text-xs font-mono text-zinc-500">
            <span>{points} puntos recolectados</span>
            <span className="text-sky-400">{pct}%</span>
          </div>
          <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-500 rounded-full transition-all duration-1000"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <p className="text-xs font-mono text-zinc-600 text-center leading-relaxed">
          Estableciendo baseline de {total} puntos antes de activar la detección de anomalías.
          <br />Las predicciones estarán disponibles en ~{Math.ceil((total - points) * 5 / 60)} min.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-8">
      <p className="text-xs font-mono uppercase tracking-[0.3em] text-zinc-500">
        Tiempo hasta fallo estimado
      </p>
      <div className={cn(
        'font-mono font-black leading-none tracking-tight transition-colors duration-700',
        status === 'HEALTHY' ? 'text-[72px] md:text-[110px] lg:text-[136px]' : 'text-[96px] md:text-[144px] lg:text-[168px]',
        colors.text,
        status === 'CRITICAL'  && 'animate-pulse',
      )}>
        {status === 'HEALTHY' ? '> 24h' : formatTTF(ttf)}
      </div>
      {status !== 'UNKNOWN' && status !== 'CALIBRATING' && (
        <p className="text-sm text-zinc-500 font-mono">
          {status === 'HEALTHY'   && 'Infraestructura operando dentro de parámetros normales'}
          {status === 'DEGRADING' && 'Anomalía en progresión — monitoreo activo recomendado'}
          {status === 'CRITICAL'  && 'Intervención del operador requerida — ver Runbook'}
        </p>
      )}
    </div>
  )
}