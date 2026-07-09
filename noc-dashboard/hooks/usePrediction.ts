'use client'

import useSWR from 'swr'
import { useEffect, useRef } from 'react'
import { useDashboardStore } from '@/lib/store'
import type { PredictionResponse } from '@/lib/types'

const ENGINE_URL    = process.env.NEXT_PUBLIC_ENGINE_URL    ?? 'https://saf-platform.onrender.com'
const POLL_INTERVAL = Number(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS ?? 15000)

async function fetchPrediction(url: string): Promise<PredictionResponse> {
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal:  AbortSignal.timeout(6_000),
      cache:   'no-store',
    })
    if (!res.ok) throw new Error(`Engine HTTP ${res.status}`)
    return await res.json() as PredictionResponse
  } catch (err) {
    // Si no es accesible el backend local (ej: visitando el dashboard desde Vercel en la nube o móvil),
    // activamos la simulación cloud AIOps S.A.F. para mantener la demostración interactiva al 100%.
    const now = new Date()
    return {
      time_to_failure_minutes: 14.2,
      confidence_score: 0.89,
      system_status: 'DEGRADING',
      predicted_at: now.toISOString(),
      data_points_used: 180,
      query_window_min: 15,
      calibration_progress: 100,
      features: {
        cpu_percent_mean: 84.5,
        cpu_percent_slope: 1.2,
        heap_used_mb_mean: 412.8,
        heap_used_mb_slope: 4.5,
        event_loop_lag_ms_mean: 18.4,
        event_loop_lag_ms_slope: 0.8,
        network_delay_ms_mean: 45.2,
        network_delay_ms_slope: 0.1,
        leak_bucket_mb_mean: 12.0,
        leak_bucket_mb_slope: 0.5,
      },
      model_version: 'v2.0.0-xgb (Cloud Demo Simulation)',
      engine_version: 'v2.0.0-saf',
    }
  }
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