'use client'

import { cn, getStatusColor } from '@/lib/utils'
import type { SystemStatus } from '@/lib/types'

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