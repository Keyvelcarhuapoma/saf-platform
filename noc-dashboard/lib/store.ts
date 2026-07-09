/**
 * Store global de Zustand para el estado del NOC Dashboard.
 *
 * PATRÓN DE SELECTORES ATÓMICOS:
 *   Cada componente suscribe SOLO al slice de estado que necesita.
 *   Esto garantiza que un cambio en `ttf` no re-renderice componentes
 *   que solo muestran `confidence_score` o el estado de conexión.
 *
 *   Ejemplo de uso:
 *     const ttf = useDashboardStore(state => state.prediction?.time_to_failure_minutes)
 *     → Solo re-renderiza cuando TTF cambia, no en cada actualización del store.
 */

import { create } from 'zustand'
import type { DashboardState, PredictionResponse } from './types'
import type { MonitoredTarget } from '@/components/dashboard/TargetScanner'

interface DashboardActions {
  setPrediction:       (prediction: PredictionResponse) => void
  setLoading:          (loading: boolean) => void
  setConnected:        (connected: boolean) => void
  setActiveMainTarget: (target: MonitoredTarget | null) => void
  incrementError:      () => void
  resetErrors:         () => void
  openRunbook:         () => void
  closeRunbook:        () => void
  acknowledge:         () => void
  resetAcknowledge:    () => void
}

type DashboardStore = DashboardState & { activeMainTarget: MonitoredTarget | null } & DashboardActions

export const useDashboardStore = create<DashboardStore>((set) => ({
  // ── Estado inicial ────────────────────────────────────────────────────────
  prediction:       null,
  activeMainTarget: null,
  isLoading:        true,
  isConnected:      false,
  lastUpdatedAt:    null,
  errorCount:       0,
  isRunbookOpen:    false,
  isAcknowledged:   false,
  acknowledgedAt:   null,

  // ── Acciones ──────────────────────────────────────────────────────────────
  setPrediction: (prediction) => set({
    prediction,
    isLoading:     false,
    isConnected:   true,
    lastUpdatedAt: new Date(),
    errorCount:    0,
  }),

  setActiveMainTarget: (activeMainTarget) => set({ activeMainTarget }),

  setLoading:   (isLoading)   => set({ isLoading }),
  setConnected: (isConnected) => set({ isConnected }),

  incrementError: () => set((state) => ({
    errorCount:  state.errorCount + 1,
    isConnected: false,
  })),

  resetErrors: () => set({ errorCount: 0, isConnected: true }),

  openRunbook:  () => set({ isRunbookOpen: true }),
  closeRunbook: () => set({ isRunbookOpen: false }),

  acknowledge: () => set({
    isAcknowledged: true,
    acknowledgedAt: new Date(),
    isRunbookOpen:  false,
  }),

  resetAcknowledge: () => set({
    isAcknowledged: false,
    acknowledgedAt: null,
  }),
})) 