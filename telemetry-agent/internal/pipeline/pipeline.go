// Paquete pipeline orquesta el ciclo completo de telemetría del S.A.F. Agent:
//
//	[Collector Goroutine]  →  [Ring Buffer]  →  [Flusher Goroutine]
//	      cada 5s             (non-blocking)      cada 15s o 20 puntos
//
// El Collector nunca espera al Flusher. El Flusher nunca bloquea al Collector.
// La única comunicación entre ambos es a través del Ring Buffer.
//
// CICLO DE VIDA:
//  1. pipeline.New()  — crea e inicializa todos los componentes
//  2. pipeline.Run()  — lanza los goroutines, bloquea hasta shutdown
//  3. Señal OS        — Run() captura SIGTERM/SIGINT
//  4. pipeline.drain()— vacía el buffer antes de cerrar
//  5. pipeline.Run()  retorna — el proceso termina limpiamente
package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/saf-platform/telemetry-agent/internal/collector"
	"github.com/saf-platform/telemetry-agent/internal/influx"
	"github.com/saf-platform/telemetry-agent/internal/ringbuffer"
)

// Config agrupa toda la configuración del pipeline.
type Config struct {
	// Intervalo entre muestras del collector
	CollectInterval time.Duration
	// Capacidad del ring buffer en número de Snapshots
	RingBufferCapacity int
	// Número de puntos que disparan un flush inmediato
	BatchFlushSize int
	// Intervalo máximo entre flushes aunque el batch no esté lleno
	BatchFlushInterval time.Duration
	// URL del Target Server (ej: http://localhost:3001)
	TargetURL string
	// Configuración del writer de InfluxDB
	InfluxConfig influx.Config
}

// Pipeline es el orquestador central del agente de telemetría.
type Pipeline struct {
	cfg        Config
	collector  collector.Collector
	buffer     *ringbuffer.RingBuffer
	writer     *influx.Writer
	httpClient *http.Client
}

// New crea un nuevo Pipeline validando y conectando todos los componentes.
func New(cfg Config) (*Pipeline, error) {
	// Inicializamos el collector específico del OS
	// (el compilador selecciona collector_linux.go o collector_windows.go
	// automáticamente gracias a los build tags)
	col, err := collector.NewCollector()
	if err != nil {
		return nil, fmt.Errorf("error inicializando collector OS: %w", err)
	}

	// Inicializamos el ring buffer
	buf := ringbuffer.New(cfg.RingBufferCapacity)

	// Inicializamos el writer de InfluxDB
	w, err := influx.New(cfg.InfluxConfig)
	if err != nil {
		return nil, fmt.Errorf("error inicializando influx writer: %w", err)
	}

	// Cliente HTTP para consultar el Target Server
	// Timeout bajo — si el target no responde en 3s, la muestra se marca con ceros
	httpClient := &http.Client{Timeout: 3 * time.Second}

	return &Pipeline{
		cfg:        cfg,
		collector:  col,
		buffer:     buf,
		writer:     w,
		httpClient: httpClient,
	}, nil
}

// Run inicia el pipeline y bloquea hasta recibir SIGTERM o SIGINT.
// Al recibir la señal, drena el buffer y retorna limpiamente.
func (p *Pipeline) Run(logger interface {
	Info(string, ...any)
	Warn(string, ...any)
	Error(string, ...any)
}) error {
	// Contexto raíz — cancelado al recibir la señal de shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Canal para capturar señales del OS
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)

	logger.Info(fmt.Sprintf("Pipeline iniciado | collector: %s | buffer: %d | target: %s",
		p.collector.Name(), p.cfg.RingBufferCapacity, p.cfg.TargetURL))

	// ── Goroutine 1: Collector ────────────────────────────────────────────────
	// Recolecta métricas del OS y del Target Server cada CollectInterval.
	// Nunca se bloquea — Push al ring buffer es O(1).
	go p.runCollector(ctx, logger)

	// ── Goroutine 2: Flusher ──────────────────────────────────────────────────
	// Lee del ring buffer y escribe a InfluxDB en batches.
	// Si InfluxDB está caído, el exponential backoff lo maneja internamente.
	go p.runFlusher(ctx, logger)

	// Bloqueamos hasta recibir señal de shutdown
	sig := <-sigChan
	logger.Info(fmt.Sprintf("Señal '%s' recibida — iniciando graceful shutdown", sig))

	// Cancelamos el contexto — ambos goroutines terminarán en su próxima iteración
	cancel()

	// Drenamos el buffer: enviamos todos los puntos pendientes antes de cerrar
	p.drain(logger)

	logger.Info("Pipeline cerrado limpiamente — todos los puntos enviados a InfluxDB")
	return nil
}

// runCollector es el goroutine de recolección.
// Tick cada CollectInterval, recolecta métricas del OS y del Target Server,
// y hace Push al ring buffer.
func (p *Pipeline) runCollector(ctx context.Context, logger interface {
	Info(string, ...any)
	Warn(string, ...any)
	Error(string, ...any)
}) {
	ticker := time.NewTicker(p.cfg.CollectInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return

		case <-ticker.C:
			// Recolectamos métricas del OS (zero-allocation en Linux)
			snap, err := p.collector.Collect()
			if err != nil {
				logger.Error(fmt.Sprintf("Error en collector OS: %v", err))
				continue
			}

			// Enriquecemos el snapshot con métricas del Target Server
			p.enrichWithTargetMetrics(&snap, logger)

			// Añadimos métricas internas del agente (visibilidad del pipeline)
			snap.BufferOccupancy = p.buffer.Len()
			snap.DroppedPoints = p.buffer.DroppedTotal.Load()

			// Push al ring buffer — nunca bloquea
			p.buffer.Push(snap)

			logger.Info(fmt.Sprintf(
				"Muestra recolectada | cpu: %.1f%% | heap: %.1fMB | lag: %.1fms | buffer: %d/%d | drops: %d",
				snap.CPUPercent,
				snap.TargetHeapUsedMB,
				snap.TargetEventLoopLagMs,
				snap.BufferOccupancy,
				p.cfg.RingBufferCapacity,
				snap.DroppedPoints,
			))
		}
	}
}

// runFlusher es el goroutine de escritura a InfluxDB.
// Hace flush cuando el buffer alcanza BatchFlushSize O cuando pasa BatchFlushInterval.
func (p *Pipeline) runFlusher(ctx context.Context, logger interface {
	Info(string, ...any)
	Warn(string, ...any)
	Error(string, ...any)
}) {
	ticker := time.NewTicker(p.cfg.BatchFlushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return

		case <-ticker.C:
			p.flushBatch(ctx, logger)
		}
	}
}

// flushBatch extrae un batch del ring buffer y lo envía a InfluxDB.
func (p *Pipeline) flushBatch(ctx context.Context, logger interface {
	Info(string, ...any)
	Warn(string, ...any)
	Error(string, ...any)
}) {
	batch := p.buffer.PopBatch(p.cfg.BatchFlushSize)
	if len(batch) == 0 {
		return
	}

	start := time.Now()
	if err := p.writer.WriteBatch(ctx, batch); err != nil {
		logger.Error(fmt.Sprintf("Error escribiendo batch a InfluxDB (%d puntos): %v", len(batch), err))
		// Re-insertamos los puntos en el buffer para el próximo intento
		// Si el buffer está lleno, se descartarán los más viejos (política FIFO drop)
		for _, snap := range batch {
			p.buffer.Push(snap)
		}
		return
	}

	logger.Info(fmt.Sprintf("Batch enviado a InfluxDB | puntos: %d | duración: %v",
		len(batch), time.Since(start).Round(time.Millisecond)))
}

// drain vacía completamente el ring buffer enviando todos los puntos pendientes.
// Llamado durante el graceful shutdown con un contexto de timeout propio.
func (p *Pipeline) drain(logger interface {
	Info(string, ...any)
	Warn(string, ...any)
	Error(string, ...any)
}) {
	pending := p.buffer.Len()
	if pending == 0 {
		logger.Info("Buffer vacío — nada que drenar en shutdown")
		return
	}

	logger.Info(fmt.Sprintf("Drenando buffer de shutdown: %d puntos pendientes", pending))

	// Damos 30 segundos para drenar — si no termina, cerramos igual
	drainCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	flushed := 0
	for p.buffer.Len() > 0 {
		batch := p.buffer.PopBatch(p.cfg.BatchFlushSize)
		if err := p.writer.WriteBatch(drainCtx, batch); err != nil {
			logger.Error(fmt.Sprintf("Error en drain de shutdown: %v — %d puntos perdidos", err, len(batch)))
			break
		}
		flushed += len(batch)
	}

	logger.Info(fmt.Sprintf("Drain completado: %d/%d puntos enviados", flushed, pending))
}

// targetStatusResponse es el subset del JSON de /api/status que nos interesa.
// Solo deserializamos los campos que necesitamos — el resto se ignora.
type targetStatusResponse struct {
	Process struct {
		EventLoopLagMs    float64 `json:"eventLoopLagMs"`
		RequestDurationMs float64 `json:"requestDurationMs"`
	} `json:"process"`
	Memory struct {
		HeapUsedMB   float64 `json:"heapUsedMB"`
		LeakBucketMB float64 `json:"leakBucketMB"`
	} `json:"memory"`
	Network struct {
		DelayMs float64 `json:"delayMs"`
	} `json:"network"`
}

// enrichWithTargetMetrics hace un GET a /api/status del Target Server
// y completa los campos del Snapshot relacionados con el servidor objetivo.
// Si el Target Server no responde, deja los campos en cero sin bloquear.
func (p *Pipeline) enrichWithTargetMetrics(snap *collector.Snapshot, logger interface {
	Info(string, ...any)
	Warn(string, ...any)
	Error(string, ...any)
}) {
	resp, err := p.httpClient.Get(p.cfg.TargetURL + "/api/status")
	if err != nil {
		logger.Warn(fmt.Sprintf("Target Server no disponible: %v — muestra con campos de target en cero", err))
		return
	}
	defer resp.Body.Close()

	var status targetStatusResponse
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		logger.Warn(fmt.Sprintf("Error parseando respuesta del Target Server: %v", err))
		return
	}

	snap.TargetHeapUsedMB = status.Memory.HeapUsedMB
	snap.TargetLeakBucketMB = status.Memory.LeakBucketMB
	snap.TargetEventLoopLagMs = status.Process.EventLoopLagMs
	snap.TargetNetworkDelayMs = status.Network.DelayMs
	snap.TargetRequestDurationMs = status.Process.RequestDurationMs
}
