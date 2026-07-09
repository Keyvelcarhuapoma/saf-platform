'use client'

import React, { useState, useEffect } from 'react'
import { Globe, Radar, CheckCircle2, ShieldCheck, RefreshCw, Server, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function TargetScanner() {
  const [targetUrl, setTargetUrl] = useState('https://mi-tienda-web.vercel.app')
  const [isScanning, setIsScanning] = useState(false)
  const [scanState, setScanState] = useState<'IDLE' | 'SCANNING' | 'CONNECTED'>('CONNECTED')
  const [pingLatency, setPingLatency] = useState(32)

  // Simulación realista de latencia cambiante
  useEffect(() => {
    if (scanState !== 'CONNECTED') return
    const interval = setInterval(() => {
      setPingLatency(prev => Math.max(18, Math.min(65, prev + Math.floor(Math.random() * 9) - 4)))
    }, 4000)
    return () => clearInterval(interval)
  }, [scanState])

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault()
    if (!targetUrl) return

    setIsScanning(true)
    setScanState('SCANNING')

    setTimeout(() => {
      setIsScanning(false)
      setScanState('CONNECTED')
      setPingLatency(Math.floor(Math.random() * 25) + 22)
    }, 1800)
  }

  const presets = [
    { label: '🛒 E-Commerce Cloud', url: 'https://mi-tienda-web.vercel.app' },
    { label: '🏦 Banking Gateway API', url: 'https://gateway-banco.onrender.com' },
    { label: '🖥️ Local Target Server', url: 'http://localhost:3001' },
  ]

  return (
    <div className="w-full max-w-4xl bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-4 shadow-2xl backdrop-blur-md transition-all duration-300 hover:border-zinc-700/80">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-zinc-900 pb-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Radar className={cn("w-4 h-4", isScanning && "animate-spin text-amber-400")} />
          </div>
          <div>
            <h3 className="text-xs font-mono font-semibold text-zinc-300 tracking-wide uppercase flex items-center gap-2">
              S.A.F. Active Web Scanner
              <span className="text-[10px] bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded border border-zinc-800 font-normal">
                Live Interceptor
              </span>
            </h3>
            <p className="text-[11px] font-mono text-zinc-500">
              Conecta y escanea la telemetría vital (`/api/status`) de cualquier página web en tiempo real
            </p>
          </div>
        </div>

        {scanState === 'CONNECTED' && !isScanning && (
          <div className="flex items-center gap-3 bg-emerald-950/20 border border-emerald-900/40 px-3 py-1.5 rounded-lg">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-mono text-emerald-400 font-medium">Objetivo Vinculado</span>
            <span className="text-xs font-mono text-zinc-500">|</span>
            <span className="text-xs font-mono text-zinc-400">{pingLatency} ms</span>
          </div>
        )}
      </div>

      <form onSubmit={handleScan} className="flex flex-col sm:flex-row gap-2 items-center">
        <div className="relative flex-1 w-full">
          <Globe className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="Introduce la URL de tu página web o API (ej: https://mi-web.com)"
            className="w-full bg-zinc-900/90 border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
          />
        </div>

        <button
          type="submit"
          disabled={isScanning || !targetUrl}
          className={cn(
            "w-full sm:w-auto px-5 py-2 rounded-lg text-xs font-mono font-semibold flex items-center justify-center gap-2 transition-all duration-200 shadow-lg",
            isScanning
              ? "bg-amber-500/20 border border-amber-500/40 text-amber-300 cursor-wait"
              : "bg-emerald-600 hover:bg-emerald-500 text-zinc-950 shadow-emerald-900/20"
          )}
        >
          {isScanning ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Escaneando Heap...</span>
            </>
          ) : (
            <>
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Escanear y Conectar</span>
              <ArrowRight className="w-3 h-3 ml-0.5" />
            </>
          )}
        </button>
      </form>

      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-zinc-900/60 overflow-x-auto pb-1">
        <span className="text-[10px] font-mono text-zinc-600 whitespace-nowrap">Presets rápidos:</span>
        {presets.map((preset, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => {
              setTargetUrl(preset.url)
              setIsScanning(true)
              setScanState('SCANNING')
              setTimeout(() => {
                setIsScanning(false)
                setScanState('CONNECTED')
                setPingLatency(Math.floor(Math.random() * 20) + 24)
              }, 1200)
            }}
            className="text-[10px] font-mono px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800/80 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors whitespace-nowrap flex items-center gap-1.5"
          >
            <Server className="w-2.5 h-2.5 text-zinc-500" />
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  )
}
