'use client'

import { usePrediction }       from '@/hooks/usePrediction'
import { useDashboardStore }   from '@/lib/store'
import { getStatusColor, cn }  from '@/lib/utils'
import { TTFDisplay }          from '@/components/dashboard/TTFDisplay'
import { StatusBadge }         from '@/components/dashboard/StatusBadge'
import { MetricsGrid }         from '@/components/dashboard/MetricsGrid'
import { ConfidenceGauge }     from '@/components/dashboard/ConfidenceGauge'
import { RunbookSlideOver }    from '@/components/dashboard/RunbookSlideOver'
import { TargetScanner }       from '@/components/dashboard/TargetScanner'
import { Activity, Wifi, WifiOff, Clock } from 'lucide-react'

export default function NOCDashboard() {
  const { isError } = usePrediction()

  const status         = useDashboardStore(s => s.prediction?.system_status ?? 'UNKNOWN')
  const isConnected    = useDashboardStore(s => s.isConnected)
  const lastUpdatedAt  = useDashboardStore(s => s.lastUpdatedAt)
  const isLoading      = useDashboardStore(s => s.isLoading)
  const dataPoints     = useDashboardStore(s => s.prediction?.data_points_used ?? 0)
  const openRunbook    = useDashboardStore(s => s.openRunbook)
  const isAcknowledged = useDashboardStore(s => s.isAcknowledged)

  // CRITICAL se renderiza igual que DEGRADING — ambos son "estado de alerta"
  // Esta decisión permite el flujo de demo simplificado sin perder el estado interno
  const displayStatus = status === 'CRITICAL' ? 'DEGRADING' : status
  const colors        = getStatusColor(displayStatus)

  // El CTA del runbook aparece en DEGRADING y en CRITICAL (tratado como DEGRADING)
  const isAlertState = status === 'DEGRADING' || status === 'CRITICAL'

  return (
    <div className={cn(
      'min-h-screen flex flex-col transition-colors duration-1000',
      displayStatus === 'DEGRADING' && 'bg-amber-950/5',
    )}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-900">
        <div className="flex items-center gap-3">
          <Activity className="w-4 h-4 text-zinc-500" />
          <span className="text-sm font-mono font-medium text-zinc-400 tracking-wide">
            S.A.F.
          </span>
          <span className="text-xs font-mono text-zinc-700">
            AIOps Predictive Engine
          </span>
        </div>

        <div className="flex items-center gap-4">
          {lastUpdatedAt && (
            <div className="flex items-center gap-1.5 text-xs font-mono text-zinc-600">
              <Clock className="w-3 h-3" />
              {lastUpdatedAt.toLocaleTimeString('es', { hour12: false })}
            </div>
          )}
          <div className={cn(
            'flex items-center gap-1.5 text-xs font-mono',
            isConnected ? 'text-emerald-600' : 'text-red-600'
          )}>
            {isConnected
              ? <Wifi    className="w-3 h-3" />
              : <WifiOff className="w-3 h-3" />
            }
            {isConnected ? 'Engine conectado' : 'Sin conexión'}
          </div>
          <span className="text-xs font-mono text-zinc-700 hidden md:block">
            {dataPoints} puntos
          </span>
        </div>
      </header>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 gap-8">

        {/* Loading inicial */}
        {isLoading && !lastUpdatedAt && (
          <div className="flex flex-col items-center gap-4 text-zinc-600">
            <div className="w-8 h-8 border-2 border-zinc-800 border-t-zinc-500 rounded-full animate-spin" />
            <p className="text-sm font-mono">Conectando con el Predictive Engine...</p>
          </div>
        )}

        {/* Error de conexión */}
        {isError && !lastUpdatedAt && (
          <div className="flex flex-col items-center gap-3 text-red-500">
            <WifiOff className="w-8 h-8" />
            <p className="text-sm font-mono">
              No se puede conectar en {process.env.NEXT_PUBLIC_ENGINE_URL}
            </p>
          </div>
        )}

        {/* Dashboard operativo */}
        {lastUpdatedAt && (
          <>
            {/* Target Scanner Interactivo para Demo y Jurado */}
            <TargetScanner />

            {/* Badge — muestra displayStatus, no el internal status */}
            <StatusBadge status={displayStatus} />

            {/* TTF Hero */}
            <TTFDisplay />

            {/* Confidence — visible en DEGRADING (y CRITICAL tratado como tal) */}
            <ConfidenceGauge />

            {/* Métricas secundarias — visibles en estado de alerta */}
            <MetricsGrid />

            {/* CTA del Runbook — aparece en DEGRADING y CRITICAL
                CAMBIO DEMO: antes era solo en CRITICAL.
                Ahora el jurado puede ver el Runbook durante la degradación
                para entender la asistencia AIOps en acción. */}
            {isAlertState && !isAcknowledged && (
              <button
                onClick={openRunbook}
                className={cn(
                  'flex items-center gap-2 px-6 py-3 rounded-lg',
                  'text-sm font-mono font-semibold transition-all duration-200',
                  'bg-amber-950 border border-amber-700 text-amber-300',
                  'hover:bg-amber-900 hover:border-amber-600',
                )}
              >
                Abrir Runbook de Mitigación →
              </button>
            )}

            {/* Confirmación de acknowledge */}
            {isAcknowledged && (
              <div className="flex items-center gap-2 text-xs font-mono text-zinc-600 border border-zinc-800 px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                Incidente reconocido — monitoreando recuperación
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="px-6 py-3 border-t border-zinc-900">
        <div className="flex items-center justify-between text-xs font-mono text-zinc-700">
          <span>v2.0.0 — XGBoost Engine</span>
          <span>Polling cada {Math.round(
            Number(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS ?? 15000) / 1000
          )}s</span>
          <span>S.A.F. Platform</span>
        </div>
      </footer>

      <RunbookSlideOver />
    </div>
  )
}