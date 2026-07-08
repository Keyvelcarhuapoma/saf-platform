// Paquete influx implementa el batch writer HTTP custom para InfluxDB v2.
//
// DECISIÓN ARQUITECTÓNICA (aprobada):
//   No usamos el cliente oficial influxdb-client-go. En su lugar, construimos
//   directamente sobre el endpoint HTTP /api/v2/write de InfluxDB.
//
// POR QUÉ:
//   1. Control total del retry loop y el exponential backoff
//   2. Visibilidad exacta del estado del batch antes, durante y después del envío
//   3. Cero dependencias transitivas — el cliente oficial trae 8+ dependencias
//   4. El protocolo Line Protocol de InfluxDB es trivialmente simple:
//      "measurement,tag1=v1 field1=v1 timestamp\n"
//
// PROTOCOLO LINE PROTOCOL v2:
//   <measurement>[,<tag_key>=<tag_value>...] <field_key>=<field_value>[,...] [<timestamp>]
//   Ejemplo:
//   system_metrics,host=prod-01,worker=1 cpu_percent=45.2,heap_used_mb=128.5 1718000000000000000
//
// EXPONENTIAL BACKOFF:
//   Intento 1: espera initialDelay
//   Intento 2: espera initialDelay × multiplier
//   Intento 3: espera initialDelay × multiplier²
//   ...hasta maxDelay
//   Con jitter aleatorio (±10%) para evitar el "thundering herd problem"
//   cuando múltiples agentes reintentan simultáneamente.
package influx

import (
	"bytes"
	"context"
	"fmt"
	"math"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"github.com/saf-platform/telemetry-agent/internal/collector"
)

// Config contiene toda la configuración necesaria para conectarse a InfluxDB.
type Config struct {
	URL        string        // URL base de InfluxDB (ej: https://us-east-1-1.aws.cloud2.influxdata.com)
	Token      string        // Token de autenticación con permisos de escritura
	Org        string        // Nombre de la organización en InfluxDB Cloud
	Bucket     string        // Nombre del bucket donde se escribirán las métricas
	Timeout    time.Duration // Timeout por request HTTP (default: 10s)

	// Configuración del exponential backoff
	BackoffInitial    time.Duration // Espera inicial antes del primer retry
	BackoffMultiplier float64       // Factor de crecimiento del backoff
	BackoffMax        time.Duration // Espera máxima entre reintentos
	MaxRetries        int           // Número máximo de reintentos por batch
}

// Writer es el componente responsable de formatear snapshots en Line Protocol
// y enviarlos a InfluxDB via HTTP con retry y exponential backoff.
type Writer struct {
	cfg        Config
	httpClient *http.Client
	writeURL   string

	// Buffer interno para construir el cuerpo del request HTTP.
	// Pre-allocado y reutilizado entre llamadas para evitar presión sobre el GC.
	lineBuf strings.Builder
}

// New crea un nuevo Writer validando la configuración.
// Retorna error si algún campo obligatorio está vacío.
func New(cfg Config) (*Writer, error) {
	if cfg.URL == ""    { return nil, fmt.Errorf("influx.Config: URL es requerido") }
	if cfg.Token == ""  { return nil, fmt.Errorf("influx.Config: Token es requerido") }
	if cfg.Org == ""    { return nil, fmt.Errorf("influx.Config: Org es requerido") }
	if cfg.Bucket == "" { return nil, fmt.Errorf("influx.Config: Bucket es requerido") }

	// Aplicamos defaults para campos opcionales
	if cfg.Timeout == 0           { cfg.Timeout = 10 * time.Second }
	if cfg.BackoffInitial == 0    { cfg.BackoffInitial = 500 * time.Millisecond }
	if cfg.BackoffMultiplier == 0 { cfg.BackoffMultiplier = 2.0 }
	if cfg.BackoffMax == 0        { cfg.BackoffMax = 60 * time.Second }
	if cfg.MaxRetries == 0        { cfg.MaxRetries = 5 }

	writeURL := fmt.Sprintf("%s/api/v2/write?org=%s&bucket=%s&precision=ns",
		strings.TrimRight(cfg.URL, "/"), cfg.Org, cfg.Bucket)

	return &Writer{
		cfg:      cfg,
		writeURL: writeURL,
		httpClient: &http.Client{
			Timeout: cfg.Timeout,
			// Deshabilitamos el redirect automático — InfluxDB no redirige
			// y queremos tratar los 3xx como errores explícitos.
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

// WriteBatch serializa un slice de Snapshots en InfluxDB Line Protocol
// y los envía en un único request HTTP POST con retry y backoff.
//
// El contexto permite cancelar la operación desde el graceful shutdown.
// Si el contexto es cancelado durante un retry, la función retorna inmediatamente.
func (w *Writer) WriteBatch(ctx context.Context, batch []collector.Snapshot) error {
	if len(batch) == 0 {
		return nil
	}

	// Construimos el body completo en el buffer reutilizable
	body := w.buildLineProtocol(batch)

	// Intentamos el envío con exponential backoff
	var lastErr error
	for attempt := 0; attempt <= w.cfg.MaxRetries; attempt++ {
		// Verificamos cancelación antes de cada intento
		select {
		case <-ctx.Done():
			return fmt.Errorf("WriteBatch cancelado por contexto: %w", ctx.Err())
		default:
		}

		if err := w.doWrite(ctx, body); err != nil {
			lastErr = err

			if attempt < w.cfg.MaxRetries {
				delay := w.computeBackoff(attempt)
				// Esperamos el delay o hasta que el contexto se cancele
				select {
				case <-ctx.Done():
					return fmt.Errorf("WriteBatch cancelado durante backoff: %w", ctx.Err())
				case <-time.After(delay):
					// Continuamos con el siguiente intento
				}
			}
			continue
		}

		// Éxito — retornamos sin error
		return nil
	}

	return fmt.Errorf("WriteBatch falló después de %d intentos: %w", w.cfg.MaxRetries, lastErr)
}

// doWrite ejecuta un único intento de escritura HTTP a InfluxDB.
// Retorna nil en éxito (HTTP 204), error descriptivo en cualquier otro caso.
func (w *Writer) doWrite(ctx context.Context, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.writeURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("error construyendo request HTTP: %w", err)
	}

	// Headers requeridos por InfluxDB v2 API
	req.Header.Set("Authorization", "Token "+w.cfg.Token)
	req.Header.Set("Content-Type", "text/plain; charset=utf-8")
	req.Header.Set("Accept", "application/json")

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("error en request HTTP: %w", err)
	}
	defer resp.Body.Close()

	// InfluxDB retorna 204 No Content en escritura exitosa
	if resp.StatusCode == http.StatusNoContent {
		return nil
	}

	// Cualquier otro status es un error — leemos el body para el mensaje de error
	var errBody [512]byte
	n, _ := resp.Body.Read(errBody[:])
	return fmt.Errorf("InfluxDB retornó HTTP %d: %s", resp.StatusCode, string(errBody[:n]))
}

// buildLineProtocol convierte un batch de Snapshots al formato
// InfluxDB Line Protocol v2 y retorna el body completo como []byte.
//
// Formato de cada línea:
//   system_metrics,host=<hostname>,collector=<os> cpu_percent=45.2,...  <timestamp_ns>
//
// Reutilizamos w.lineBuf para evitar allocations por batch.
func (w *Writer) buildLineProtocol(batch []collector.Snapshot) []byte {
	w.lineBuf.Reset()

	for _, snap := range batch {
		// ── Measurement + Tags ─────────────────────────────────────────────
		// Los tags son metadatos indexados en InfluxDB — usados para filtrar
		// y agrupar en queries. Deben tener baja cardinalidad.
		w.lineBuf.WriteString("system_metrics")
		w.lineBuf.WriteString(",bucket=saf-telemetry")

		// ── Fields ────────────────────────────────────────────────────────
		// Los fields son los valores numéricos que se almacenan en la serie.
		w.lineBuf.WriteString(" ")

		// CPU
		fmt.Fprintf(&w.lineBuf, "cpu_percent=%.4f", snap.CPUPercent)

		// Memoria del sistema
		fmt.Fprintf(&w.lineBuf, ",mem_total_mb=%.2f", snap.MemTotalMB)
		fmt.Fprintf(&w.lineBuf, ",mem_available_mb=%.2f", snap.MemAvailableMB)
		fmt.Fprintf(&w.lineBuf, ",mem_used_percent=%.4f", snap.MemUsedPercent)

		// Métricas del Target Server
		fmt.Fprintf(&w.lineBuf, ",target_heap_used_mb=%.2f", snap.TargetHeapUsedMB)
		fmt.Fprintf(&w.lineBuf, ",target_leak_bucket_mb=%.2f", snap.TargetLeakBucketMB)
		fmt.Fprintf(&w.lineBuf, ",target_event_loop_lag_ms=%.3f", snap.TargetEventLoopLagMs)
		fmt.Fprintf(&w.lineBuf, ",target_network_delay_ms=%.2f", snap.TargetNetworkDelayMs)
		fmt.Fprintf(&w.lineBuf, ",target_request_duration_ms=%.2f", snap.TargetRequestDurationMs)

		// Métricas internas del agente
		fmt.Fprintf(&w.lineBuf, ",buffer_occupancy=%di", snap.BufferOccupancy)
		fmt.Fprintf(&w.lineBuf, ",dropped_points=%di", snap.DroppedPoints)

		// ── Timestamp en nanosegundos ──────────────────────────────────────
		fmt.Fprintf(&w.lineBuf, " %d\n", snap.CollectedAt.UnixNano())
	}

	return []byte(w.lineBuf.String())
}

// computeBackoff calcula el tiempo de espera para el attempt-ésimo reintento.
// Incluye jitter aleatorio (±10%) para evitar el thundering herd problem.
//
// Fórmula: min(initialDelay × multiplier^attempt, maxDelay) × jitter
func (w *Writer) computeBackoff(attempt int) time.Duration {
	base := float64(w.cfg.BackoffInitial) * math.Pow(w.cfg.BackoffMultiplier, float64(attempt))
	maxF := float64(w.cfg.BackoffMax)

	if base > maxF {
		base = maxF
	}

	// Jitter: factor aleatorio entre 0.9 y 1.1
	jitter := 0.9 + rand.Float64()*0.2
	return time.Duration(base * jitter)
}