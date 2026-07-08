import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { SystemStatus } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTTF(minutes: number | null): string {
  if (minutes === null) return '—'
  if (minutes <= 0)     return 'COLAPSO INMINENTE'
  if (minutes < 1)      return '< 1 min'
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const mins  = Math.floor(minutes % 60)
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }
  const mins = Math.floor(minutes)
  const secs = Math.floor((minutes - mins) * 60)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

export function getStatusColor(status: SystemStatus): {
  text: string; bg: string; border: string; glow: string; accent: string
} {
  const map: Record<SystemStatus, ReturnType<typeof getStatusColor>> = {
    HEALTHY: {
      text: 'text-emerald-400', bg: 'bg-emerald-950/30',
      border: 'border-emerald-800/50', glow: 'shadow-emerald-900/20', accent: 'bg-emerald-500',
    },
    CALIBRATING: {
      text: 'text-sky-400', bg: 'bg-sky-950/20',
      border: 'border-sky-800/40', glow: 'shadow-sky-900/10', accent: 'bg-sky-500',
    },
    DEGRADING: {
      text: 'text-amber-400', bg: 'bg-amber-950/30',
      border: 'border-amber-800/50', glow: 'shadow-amber-900/20', accent: 'bg-amber-500',
    },
    CRITICAL: {
      text: 'text-red-400', bg: 'bg-red-950/40',
      border: 'border-red-800/60', glow: 'shadow-red-900/30', accent: 'bg-red-500',
    },
    UNKNOWN: {
      text: 'text-zinc-500', bg: 'bg-zinc-900/30',
      border: 'border-zinc-800/50', glow: 'shadow-zinc-900/10', accent: 'bg-zinc-600',
    },
  }
  return map[status] ?? map.UNKNOWN
}

export function formatSlope(slope: number): string {
  const abs = Math.abs(slope).toFixed(4)
  if (slope > 0.001)  return `↑ +${abs}`
  if (slope < -0.001) return `↓ -${abs}`
  return `→ ${abs}`
} 