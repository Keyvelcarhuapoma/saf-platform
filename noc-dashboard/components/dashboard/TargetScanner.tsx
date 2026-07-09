'use client'

import React, { useState, useEffect } from 'react'
import { Globe, Radar, CheckCircle2, ShieldCheck, RefreshCw, Server, ArrowRight, Plus, Trash2, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MonitoredTarget {
  id: string
  name: string
  url: string
  status: 'ONLINE' | 'WARNING' | 'CHECKING'
  latency: number
  ttfMinutes: number
  isMain: boolean
}

const DEFAULT_TARGETS: MonitoredTarget[] = [
  {
    id: 't-main',
    name: 'S.A.F. Target Server (Principal)',
    url: 'http://localhost:3001',
    status: 'ONLINE',
    latency: 18,
    ttfMinutes: 56.4,
    isMain: true,
  },
]

export function TargetScanner() {
  const [inputUrl, setInputUrl] = useState('')
  const [inputName, setInputName] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [targets, setTargets] = useState<MonitoredTarget[]>(DEFAULT_TARGETS)

  // Cargar targets guardados en localStorage con clave v3 para limpiar presets antiguos
  useEffect(() => {
    try {
      const saved = localStorage.getItem('saf_monitored_targets_v3')
      if (saved) {
        setTargets(JSON.parse(saved))
      }
    } catch {}
  }, [])

  // Guardar targets en localStorage v3
  useEffect(() => {
    try {
      localStorage.setItem('saf_monitored_targets_v3', JSON.stringify(targets))
    } catch {}
  }, [targets])

  // Simulación realista de fluctuación de latencias en los targets activos
  useEffect(() => {
    const interval = setInterval(() => {
      setTargets(prev => prev.map(t => {
        if (t.status === 'CHECKING') return t
        const delta = Math.floor(Math.random() * 7) - 3
        const newLat = Math.max(14, Math.min(65, t.latency + delta))
        return { ...t, latency: newLat }
      }))
    }, 3500)
    return () => clearInterval(interval)
  }, [])

  const handleAddTarget = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputUrl) return

    setIsAdding(true)
    const newId = `t-${Date.now()}`
    const displayName = inputName.trim() || inputUrl.replace(/https?:\/\//, '').split('/')[0]

    const tempTarget: MonitoredTarget = {
      id: newId,
      name: displayName,
      url: inputUrl,
      status: 'CHECKING',
      latency: 0,
      ttfMinutes: 80.0,
      isMain: targets.length === 0, // Si no había ninguno, este es el principal
    }

    setTargets(prev => [tempTarget, ...prev])
    setInputUrl('')
    setInputName('')

    // Simular escaneo antes de marcar ONLINE
    setTimeout(() => {
      setIsAdding(false)
      setTargets(prev => prev.map(t => t.id === newId ? {
        ...t,
        status: 'ONLINE',
        latency: Math.floor(Math.random() * 25) + 18,
        ttfMinutes: Math.floor(Math.random() * 50) + 45
      } : t))
    }, 1500)
  }

  const handleDeleteTarget = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setTargets(prev => {
      const next = prev.filter(t => t.id !== id)
      if (next.length > 0 && !next.some(t => t.isMain)) {
        next[0].isMain = true
      }
      return next
    })
  }

  const handleSelectMain = (id: string) => {
    setTargets(prev => prev.map(t => ({
      ...t,
      isMain: t.id === id
    })))
  }

  return (
    <div className="w-full max-w-5xl bg-zinc-950/85 border border-zinc-800/90 rounded-2xl p-5 shadow-2xl backdrop-blur-xl transition-all duration-300">
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-zinc-900 pb-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shadow-inner">
            <Radar className={cn("w-5 h-5", isAdding && "animate-spin text-amber-400")} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-mono font-bold text-zinc-200 tracking-wider uppercase">
                S.A.F. Multi-Target Fleet Monitor
              </h3>
              <span className="text-[10px] bg-emerald-950/40 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-800/60 font-mono">
                {targets.length} {targets.length === 1 ? 'Objetivo Activo' : 'Objetivos Activos'}
              </span>
            </div>
            <p className="text-[11px] font-mono text-zinc-500 mt-0.5">
              Inspección y telemetría en tiempo real sobre los objetivos de red conectados
            </p>
          </div>
        </div>
      </div>

      {/* Formulario de Adición */}
      <form onSubmit={handleAddTarget} className="flex flex-col md:flex-row gap-2.5 items-center mb-5 bg-zinc-900/60 p-3 rounded-xl border border-zinc-800/80">
        <div className="flex-1 flex flex-col sm:flex-row gap-2 w-full">
          <input
            type="text"
            value={inputName}
            onChange={(e) => setInputName(e.target.value)}
            placeholder="Nombre del servidor (ej: Portal Producción)"
            className="w-full sm:w-1/3 bg-zinc-950/90 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-all"
          />
          <div className="relative flex-1">
            <Globe className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="URL a conectar (ej: https://mi-web.com o http://localhost:3001)"
              className="w-full bg-zinc-950/90 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-all"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isAdding || !inputUrl}
          className={cn(
            "w-full md:w-auto px-5 py-2 rounded-lg text-xs font-mono font-semibold flex items-center justify-center gap-2 transition-all duration-200 shadow-md whitespace-nowrap",
            isAdding
              ? "bg-amber-500/20 border border-amber-500/40 text-amber-300 cursor-wait"
              : "bg-emerald-600 hover:bg-emerald-500 text-zinc-950 shadow-emerald-900/30"
          )}
        >
          {isAdding ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Conectando...</span>
            </>
          ) : (
            <>
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Añadir Objetivo</span>
            </>
          )}
        </button>
      </form>

      {/* Lista / Grid de Targets */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {targets.map((target) => (
          <div
            key={target.id}
            onClick={() => handleSelectMain(target.id)}
            className={cn(
              "group relative p-3.5 rounded-xl border transition-all duration-200 cursor-pointer flex flex-col justify-between gap-2.5",
              target.isMain
                ? "bg-emerald-950/20 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
                : "bg-zinc-900/40 border-zinc-800/80 hover:border-zinc-700/80 hover:bg-zinc-900/70"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 overflow-hidden">
                <div className={cn(
                  "w-2 h-2 rounded-full flex-shrink-0",
                  target.status === 'ONLINE' ? "bg-emerald-500 animate-pulse" :
                  target.status === 'CHECKING' ? "bg-amber-400 animate-ping" : "bg-red-500"
                )} />
                <span className="text-xs font-mono font-bold text-zinc-200 truncate">
                  {target.name}
                </span>
                {target.isMain && (
                  <span className="text-[9px] bg-emerald-500 text-zinc-950 font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter">
                    Principal
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={(e) => handleDeleteTarget(target.id, e)}
                title="Eliminar este servidor"
                className="p-1 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="text-[11px] font-mono text-zinc-500 truncate flex items-center gap-1">
              <Globe className="w-3 h-3 text-zinc-600 flex-shrink-0" />
              <span className="truncate">{target.url}</span>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-zinc-800/60 text-[10px] font-mono">
              <div className="flex items-center gap-3">
                <span className="text-zinc-400">
                  Ping: <strong className={target.latency > 60 ? "text-amber-400" : "text-emerald-400"}>
                    {target.status === 'CHECKING' ? '...' : `${target.latency} ms`}
                  </strong>
                </span>
                <span className="text-zinc-600">|</span>
                <span className="text-zinc-400">
                  Estado: <strong className="text-emerald-400">Activo</strong>
                </span>
              </div>

              <div className="text-zinc-500 group-hover:text-emerald-400 transition-colors flex items-center gap-1 text-[10px]">
                <span>{target.isMain ? 'Inspeccionando' : 'Seleccionar Principal'}</span>
                <ArrowRight className="w-2.5 h-2.5" />
              </div>
            </div>
          </div>
        ))}

        {targets.length === 0 && (
          <div className="col-span-full py-8 text-center border border-dashed border-zinc-800 rounded-xl">
            <Activity className="w-8 h-8 text-zinc-600 mx-auto mb-2 opacity-50" />
            <p className="text-xs font-mono text-zinc-400">No hay servidores monitoreados</p>
            <p className="text-[11px] font-mono text-zinc-600 mt-1">Añade tu servidor o página web usando el formulario superior</p>
          </div>
        )}
      </div>
    </div>
  )
}
