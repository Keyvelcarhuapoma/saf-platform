'use client'

import { cn, getStatusColor } from '@/lib/utils'
import type { SystemStatus } from '@/lib/types'
import { useDashboardStore } from '@/lib/store'

interface StatusBadgeProps {
  status: SystemStatus
  className?: string
}

const STATUS_LABELS: Record<SystemStatus, string> = {
  HEALTHY:     'Sistema Estable',
  CALIBRATING: 'Calibrando Sistema',
  DEGRADING:   'Degradación Detectada',
  CRITICAL:    'Alerta Crítica',
  UNKNOWN:     'Sin Datos',
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const mainTarget = useDashboardStore(s => s.activeMainTarget)
  const isExternalTarget = mainTarget && !mainTarget.url.includes('localhost:3001')

  if (isExternalTarget) {
    const isErr = mainTarget.status === 'ERROR'
    return (
      <div className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium tracking-wide',
        isErr ? 'bg-red-950/60 border-red-800/80 text-red-400' : 'bg-emerald-950/60 border-emerald-800/80 text-emerald-400',
        className,
      )}>
        <span className="relative flex h-2 w-2">
          <span className={cn(
            'absolute inline-flex h-full w-full rounded-full opacity-75',
            isErr ? 'bg-red-500 animate-ping' : 'bg-emerald-500 animate-pulse',
          )} />
          <span className={cn('relative inline-flex rounded-full h-2 w-2', isErr ? 'bg-red-500' : 'bg-emerald-500')} />
        </span>
        {isErr ? `Objetivo Inaccesible (${mainTarget.name})` : `Servidor Objetivo Operativo (${mainTarget.name})`}
      </div>
    )
  }

  const colors = getStatusColor(status)

  return (
    <div className={cn(
      'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium tracking-wide',
      colors.bg, colors.border, colors.text, className,
    )}>
      <span className="relative flex h-2 w-2">
        <span className={cn(
          'absolute inline-flex h-full w-full rounded-full opacity-75',
          colors.accent,
          status === 'CRITICAL'    && 'animate-ping',
          status === 'CALIBRATING' && 'animate-pulse',
        )} />
        <span className={cn('relative inline-flex rounded-full h-2 w-2', colors.accent)} />
      </span>
      {STATUS_LABELS[status]}
    </div>
  )
}