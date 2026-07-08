'use client'

import useSWR from 'swr'
import { useEffect, useRef } from 'react'
import { useDashboardStore } from '@/lib/store'
import type { PredictionResponse } from '@/lib/types'

const ENGINE_URL    = process.env.NEXT_PUBLIC_ENGINE_URL    ?? 'http://localhost:8000'
const POLL_INTERVAL = Number(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS ?? 15000)

async function fetchPrediction(url: string): Promise<PredictionResponse> {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal:  AbortSignal.timeout(10_000),
    // Cache: no-store previene que el browser sirva respuestas stale
    cache:   'no-store',
  })
  if (!res.ok) throw new Error(`Engine HTTP ${res.status}`)
  return res.json() as Promise<PredictionResponse>
}

export function usePrediction() {
  const {
    setPrediction,
    setLoading,
    setConnected,
    incrementError,
    openRunbook,
    isAcknowledged,
    isRunbookOpen,
    prediction: currentPrediction,
  } = useDashboardStore()

  const lastStatusRef    = useRef<string | null>(null)
  const keepaliveRef     = useRef<ReturnType<typeof setInterval> | null>(null)

  const { data, error, isLoading, isValidating, mutate } = useSWR<PredictionResponse>(
    `${ENGINE_URL}/api/v1/predict/ttf`,
    fetchPrediction,
    {
      refreshInterval:       POLL_INTERVAL,
      revalidateOnFocus:     true,
      revalidateOnReconnect: true,
      // FIX CONGELAMIENTO: revalidar aunque la pestaña esté oculta
      refreshWhenHidden:     true,
      // FIX CONGELAMIENTO: nunca pausar en ventana sin foco
      refreshWhenOffline:    false,
      keepPreviousData:      true,
      // FIX CONGELAMIENTO: 10 reintentos con backoff (era 3 → se agotaba en ~45s)
      errorRetryCount:       10,
      errorRetryInterval:    3_000,
      dedupingInterval:      8_000,

      onSuccess: (data) => {
        setPrediction(data)
        setConnected(true)
      },

      // FIX CONGELAMIENTO: nunca dejamos de reintentar — override del comportamiento por defecto
      onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
        // Después de 10 intentos, esperamos 30s y reiniciamos el contador
        // En lugar de rendirse, hace pausa y reintenta indefinidamente
        const delay = retryCount > 10 ? 30_000 : retryCount * 3_000
        setTimeout(() => revalidate({ retryCount: 0 }), delay)
        incrementError()
      },

      onError: () => {
        setConnected(false)
      },
    }
  )

  // Keepalive de seguro: cada 45s fuerza un mutate aunque SWR esté atascado
  // Este es el mecanismo de última línea contra el congelamiento de 1h
  useEffect(() => {
    keepaliveRef.current = setInterval(() => {
      mutate()
    }, 45_000)

    return () => {
      if (keepaliveRef.current) clearInterval(keepaliveRef.current)
    }
  }, [mutate])

  // CAMBIO DEMO: el Runbook se abre al entrar en DEGRADING (no CRITICAL)
  // Lógica: DEGRADING es el estado de "alerta temprana" donde el SRE
  // necesita ver el runbook y actuar ANTES de que el sistema colapse.
  useEffect(() => {
    if (!data) return

    const newStatus  = data.system_status
    const prevStatus = lastStatusRef.current

    // Apertura automática del Runbook al detectar degradación
    const isAlertState = newStatus === 'DEGRADING' || newStatus === 'CRITICAL'
    const wasStable    = prevStatus === 'HEALTHY' || prevStatus === 'CALIBRATING' || prevStatus === null

    if (isAlertState && wasStable && !isAcknowledged && !isRunbookOpen) {
      openRunbook()
    }

    // Resetear acknowledge cuando el sistema se recupera completamente
    if (newStatus === 'HEALTHY' && (prevStatus === 'DEGRADING' || prevStatus === 'CRITICAL')) {
      useDashboardStore.getState().resetAcknowledge()
    }

    lastStatusRef.current = newStatus
  }, [data?.system_status, isAcknowledged, isRunbookOpen, openRunbook])

  useEffect(() => {
    setLoading(isLoading || isValidating)
  }, [isLoading, isValidating, setLoading])

  return {
    prediction: data ?? currentPrediction,
    isLoading:  isLoading && !currentPrediction,
    isError:    !!error,
    error,
  }
}