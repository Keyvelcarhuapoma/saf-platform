    'use client'

import { useState } from 'react'
import { useDashboardStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import {
  X, Copy, Check, AlertTriangle,
  Terminal, Bell, CheckCircle2,
} from 'lucide-react'

/**
 * Runbook Slide-Over — el CTA correcto para un entorno Enterprise SRE.
 *
 * NO es un "botón mágico". Es una guía de intervención estructurada que:
 *   1. Muestra el diagnóstico automático del motor predictivo
 *   2. Presenta los comandos CLI exactos a ejecutar, en orden
 *   3. Permite copiar cada comando individualmente al portapapeles
 *   4. Ofrece notificación a Slack vía Webhook documentado
 *   5. Permite marcar el incidente como Reconocido
 *
 * Esta interacción es creíble para cualquier SRE senior — refleja
 * exactamente cómo funcionan los runbooks en PagerDuty y OpsGenie.
 */

interface RunbookCommand {
  description: string
  command:     string
  warning?:    string
}

// Los comandos se generan dinámicamente basados en el estado actual
function buildRunbookCommands(heapMB: number, lagMs: number): RunbookCommand[] {
  return [
    {
      description: 'Verificar estado del proceso Node.js',
      command:     'pm2 status | grep target-server',
    },
    {
      description: 'Ver últimas líneas del log de errores',
      command:     'pm2 logs target-server --lines 50 --err',
    },
    ...(heapMB > 100 ? [{
      description: 'Heap crítico detectado — Graceful restart del servidor',
      command:     'pm2 restart target-server --update-env',
      warning:     'Causará ~2s de downtime. Verificar que el balanceador esté activo.',
    }] : []),
    ...(lagMs > 200 ? [{
      description: 'Event Loop saturado — Escalar workers horizontalmente',
      command:     'pm2 scale target-server +2',
    }] : []),
    {
      description: 'Verificar conexiones activas al servidor',
      command:     'netstat -an | grep :3001 | grep ESTABLISHED | wc -l',
    },
    {
      description: 'Forzar GC de Node.js vía señal (sin restart)',
      command:     'kill -USR2 $(pm2 pid target-server)',
      warning:     'Solo disponible si el servidor tiene --expose-gc habilitado.',
    },
  ]
}

export function RunbookSlideOver() {
  const {
    isRunbookOpen,
    closeRunbook,
    acknowledge,
    prediction,
  } = useDashboardStore()

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [webhookSent, setWebhookSent] = useState(false)
  const [webhookLoading, setWebhookLoading] = useState(false)

  const features  = prediction?.features
  const heapMB    = features?.heap_used_mb_mean   ?? 0
  const lagMs     = features?.event_loop_lag_ms_mean ?? 0
  const commands  = buildRunbookCommands(heapMB, lagMs)
  const incidentId = `SAF-${Date.now().toString(36).toUpperCase()}`

  async function copyToClipboard(command: string, index: number) {
    try {
      await navigator.clipboard.writeText(command)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
    } catch {
      // Fallback para browsers sin Clipboard API
      const textarea = document.createElement('textarea')
      textarea.value = command
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
    }
  }

  async function notifySlack() {
    const webhookUrl = process.env.NEXT_PUBLIC_SLACK_WEBHOOK_URL
    if (!webhookUrl) return

    setWebhookLoading(true)
    try {
      await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚨 *S.A.F. ALERTA CRÍTICA* — Incident \`${incidentId}\`\n` +
                `• TTF: *${prediction?.time_to_failure_minutes?.toFixed(1)} min*\n` +
                `• Confianza: *${((prediction?.confidence_score ?? 0) * 100).toFixed(0)}%*\n` +
                `• Heap: *${heapMB.toFixed(1)} MB*\n` +
                `• Event Loop Lag: *${lagMs.toFixed(0)} ms*\n` +
                `Operador notificado — revisar Runbook en el NOC Dashboard.`,
        }),
      })
      setWebhookSent(true)
    } catch (err) {
      console.error('Error enviando Webhook a Slack:', err)
    } finally {
      setWebhookLoading(false)
    }
  }

  if (!isRunbookOpen) return null

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity"
        onClick={closeRunbook}
      />

      {/* Panel lateral */}
      <div className={cn(
        'fixed right-0 top-0 h-full w-full max-w-lg z-50',
        'bg-zinc-950 border-l border-zinc-800',
        'flex flex-col overflow-hidden',
        'shadow-2xl shadow-black/50',
      )}>

        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-zinc-800 shrink-0">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className="text-sm font-mono font-semibold text-red-400 uppercase tracking-wider">
                Incident Runbook
              </span>
            </div>
            <p className="text-xs font-mono text-zinc-500">
              ID: {incidentId}
            </p>
          </div>
          <button
            onClick={closeRunbook}
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Diagnóstico automático */}
        <div className="p-6 border-b border-zinc-800 shrink-0 space-y-3">
          <p className="text-xs font-mono uppercase tracking-wider text-zinc-500">
            Diagnóstico automático
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'TTF',        value: `${prediction?.time_to_failure_minutes?.toFixed(1) ?? '—'} min` },
              { label: 'Confianza',  value: `${((prediction?.confidence_score ?? 0) * 100).toFixed(0)}%` },
              { label: 'Heap',       value: `${heapMB.toFixed(1)} MB` },
              { label: 'Loop Lag',   value: `${lagMs.toFixed(0)} ms` },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center px-3 py-2 rounded bg-zinc-900 border border-zinc-800">
                <span className="text-xs text-zinc-500 font-mono">{label}</span>
                <span className="text-sm font-mono font-semibold text-zinc-200">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Comandos del Runbook — scrolleable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          <p className="text-xs font-mono uppercase tracking-wider text-zinc-500">
            Acciones recomendadas — ejecutar en orden
          </p>

          {commands.map((cmd, index) => (
            <div
              key={index}
              className="space-y-2 p-3 rounded-lg bg-zinc-900 border border-zinc-800"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-zinc-400 leading-relaxed flex-1">
                  <span className="text-zinc-600 font-mono mr-1.5">{index + 1}.</span>
                  {cmd.description}
                </p>
              </div>

              {/* Bloque de comando */}
              <div className="flex items-center gap-2 p-2.5 rounded bg-black/60 border border-zinc-800 group">
                <Terminal className="w-3 h-3 text-zinc-600 shrink-0" />
                <code className="flex-1 text-xs font-mono text-emerald-400 break-all">
                  {cmd.command}
                </code>
                <button
                  onClick={() => copyToClipboard(cmd.command, index)}
                  className="shrink-0 p-1 rounded text-zinc-600 hover:text-zinc-300 transition-colors"
                  title="Copiar comando"
                >
                  {copiedIndex === index
                    ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                    : <Copy className="w-3.5 h-3.5" />
                  }
                </button>
              </div>

              {/* Warning si existe */}
              {cmd.warning && (
                <p className="text-xs text-amber-500/80 font-mono leading-relaxed">
                  ⚠ {cmd.warning}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Footer con acciones */}
        <div className="p-6 border-t border-zinc-800 space-y-3 shrink-0">
          {/* Notificación Slack */}
          {process.env.NEXT_PUBLIC_SLACK_WEBHOOK_URL && (
            <button
              onClick={notifySlack}
              disabled={webhookSent || webhookLoading}
              className={cn(
                'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg',
                'text-sm font-mono font-medium transition-all',
                webhookSent
                  ? 'bg-emerald-950 border border-emerald-800 text-emerald-400 cursor-default'
                  : 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700',
                webhookLoading && 'opacity-50 cursor-not-allowed',
              )}
            >
              <Bell className="w-4 h-4" />
              {webhookSent ? 'Slack notificado' : webhookLoading ? 'Enviando...' : 'Notificar a Slack'}
            </button>
          )}

          {/* Acknowledge */}
          <button
            onClick={acknowledge}
            className={cn(
              'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg',
              'text-sm font-mono font-medium transition-all',
              'bg-red-950/50 border border-red-800/60 text-red-400',
              'hover:bg-red-950 hover:border-red-700',
            )}
          >
            <CheckCircle2 className="w-4 h-4" />
            Marcar incidente como reconocido
          </button>
        </div>
      </div>
    </>
  )
}