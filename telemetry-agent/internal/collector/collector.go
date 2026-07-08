// Paquete collector define la interfaz y los tipos compartidos del sistema
// de recolección de métricas del S.A.F. Telemetry Agent.
//
// Principio de diseño: este archivo es el único contrato entre el pipeline
// y los colectores específicos por OS. Cualquier plataforma que implemente
// la interfaz Collector puede conectarse al pipeline sin cambios.
package collector

import "time"

// Snapshot representa una muestra atómica de todas las métricas del sistema
// en un instante de tiempo. Es la unidad de datos que fluye por el ring buffer.
//
// Todos los campos son tipos primitivos para garantizar zero-allocation
// al escribir en el ring buffer (no hay punteros que el GC deba rastrear).
type Snapshot struct {
	// Timestamp de cuando fue tomada la muestra (Unix nanosegundos)
	CollectedAt time.Time

	// ── Métricas de CPU ──────────────────────────────────────────────────────
	// Porcentaje de uso de CPU total del sistema (0.0 – 100.0)
	CPUPercent float64

	// ── Métricas de memoria del sistema ─────────────────────────────────────
	// Memoria RAM total del sistema en MB
	MemTotalMB float64
	// Memoria RAM disponible (libre + reclaimable) en MB
	MemAvailableMB float64
	// Porcentaje de memoria usada (0.0 – 100.0)
	MemUsedPercent float64

	// ── Métricas del Target Server (leídas via HTTP /api/status) ─────────────
	// Heap de V8 actualmente usado en MB
	TargetHeapUsedMB float64
	// Tamaño del leak bucket acumulado en MB
	TargetLeakBucketMB float64
	// Event Loop Lag reportado por el servidor en ms
	TargetEventLoopLagMs float64
	// Latencia de red simulada en ms
	TargetNetworkDelayMs float64
	// Duración total de la request al target en ms (latencia end-to-end real)
	TargetRequestDurationMs float64

	// ── Métricas internas del agente ─────────────────────────────────────────
	// Puntos actualmente encolados en el ring buffer
	BufferOccupancy int
	// Número de puntos descartados por overflow del ring buffer
	DroppedPoints int64
}

// Collector es la interfaz que deben implementar todos los colectores
// específicos por sistema operativo.
//
// Collect toma una muestra de las métricas del OS y devuelve un Snapshot
// parcialmente completado (solo campos del OS). El pipeline completa
// los campos del Target Server y del agente antes de encolarlo.
//
// Contrato de rendimiento: Collect debe completarse en menos de 1ms
// y no debe realizar allocations en el heap después de la primera llamada.
type Collector interface {
	// Collect retorna un Snapshot con las métricas del OS.
	// El error solo se retorna en fallos irrecuperables (ej: /proc no montado).
	// Errores transitorios deben ser manejados internamente y retornar
	// el último valor conocido en lugar de un error.
	Collect() (Snapshot, error)

	// Name retorna el identificador de la implementación ("linux", "windows").
	// Usado en los logs para saber qué collector está activo.
	Name() string
}