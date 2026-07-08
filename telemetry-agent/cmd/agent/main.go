// Punto de entrada del S.A.F. Telemetry Agent.
//
// Responsabilidades de main():
//   1. Cargar configuración desde variables de entorno (.env)
//   2. Inicializar el logger estructurado
//   3. Construir el Pipeline con todos sus componentes
//   4. Llamar pipeline.Run() — bloquea hasta SIGTERM/SIGINT
//
// main() no contiene lógica de negocio. Es exclusivamente
// un punto de ensamblaje (composition root).
package main

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"time"

	"github.com/saf-platform/telemetry-agent/internal/influx"
	"github.com/saf-platform/telemetry-agent/internal/pipeline"
)

func main() {
	// Cargamos las variables de entorno desde .env si existe
	loadDotEnv()

	// ── Logger estructurado con slog (stdlib Go 1.21+) ────────────────────────
	// Usamos la stdlib en lugar de Zap/Logrus para mantener zero dependencias externas.
	// slog con JSONHandler produce output idéntico en rendimiento a Zap para
	// nuestro volumen de logs (< 100 líneas/minuto).
	logLevel := slog.LevelInfo
	if getEnv("LOG_LEVEL", "info") == "debug" {
		logLevel = slog.LevelDebug
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: logLevel,
	}))

	// Adaptador para que slog implemente la interfaz que usa el pipeline
	log := &slogAdapter{logger: logger}

	log.Info("S.A.F. Telemetry Agent arrancando")

	// ── Construcción de la configuración del pipeline ─────────────────────────
	cfg := pipeline.Config{
		CollectInterval:    time.Duration(getEnvInt("COLLECT_INTERVAL_SEC", 5)) * time.Second,
		RingBufferCapacity: getEnvInt("RING_BUFFER_CAPACITY", 512),
		BatchFlushSize:     getEnvInt("BATCH_FLUSH_SIZE", 20),
		BatchFlushInterval: time.Duration(getEnvInt("BATCH_FLUSH_INTERVAL_SEC", 15)) * time.Second,
		TargetURL:          getEnv("TARGET_URL", "http://localhost:3001"),

		InfluxConfig: influx.Config{
			URL:    mustGetEnv("INFLUX_URL"),
			Token:  mustGetEnv("INFLUX_TOKEN"),
			Org:    mustGetEnv("INFLUX_ORG"),
			Bucket: getEnv("INFLUX_BUCKET", "saf-telemetry"),

			Timeout:           10 * time.Second,
			BackoffInitial:    time.Duration(getEnvInt("BACKOFF_INITIAL_MS", 500)) * time.Millisecond,
			BackoffMultiplier: getEnvFloat("BACKOFF_MULTIPLIER", 2.0),
			BackoffMax:        time.Duration(getEnvInt("BACKOFF_MAX_SEC", 60)) * time.Second,
			MaxRetries:        5,
		},
	}

	// ── Construcción e inicio del pipeline ────────────────────────────────────
	p, err := pipeline.New(cfg)
	if err != nil {
		log.Error(fmt.Sprintf("Error inicializando pipeline: %v", err))
		os.Exit(1)
	}

	// Run() bloquea hasta SIGTERM/SIGINT, luego drena y retorna
	if err := p.Run(log); err != nil {
		log.Error(fmt.Sprintf("Pipeline terminó con error: %v", err))
		os.Exit(1)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DE CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────────────────────

// loadDotEnv carga variables de entorno desde un archivo .env si existe.
// Implementación mínima sin dependencias — solo necesitamos leer KEY=VALUE.
func loadDotEnv() {
	data, err := os.ReadFile(".env")
	if err != nil {
		return // .env es opcional — no es un error si no existe
	}

	lines := splitLines(data)
	for _, line := range lines {
		if len(line) == 0 || line[0] == '#' {
			continue
		}
		for i := 0; i < len(line); i++ {
			if line[i] == '=' {
				key := line[:i]
				val := line[i+1:]
				// Solo seteamos si la variable no está ya en el entorno del OS
				if os.Getenv(key) == "" {
					os.Setenv(key, val)
				}
				break
			}
		}
	}
}

// splitLines divide un []byte en líneas sin allocations innecesarias.
func splitLines(data []byte) []string {
	var lines []string
	start := 0
	for i, b := range data {
		if b == '\n' {
			line := string(data[start:i])
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			lines = append(lines, line)
			start = i + 1
		}
	}
	if start < len(data) {
		lines = append(lines, string(data[start:]))
	}
	return lines
}

func getEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

// mustGetEnv retorna el valor de una variable de entorno obligatoria.
// Si no está seteada, imprime un error y sale del proceso (fail-fast).
func mustGetEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		fmt.Fprintf(os.Stderr, "ERROR: variable de entorno obligatoria '%s' no está seteada\n", key)
		os.Exit(1)
	}
	return v
}

func getEnvInt(key string, defaultVal int) int {
	v := os.Getenv(key)
	if v == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return defaultVal
	}
	return n
}

func getEnvFloat(key string, defaultVal float64) float64 {
	v := os.Getenv(key)
	if v == "" {
		return defaultVal
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return defaultVal
	}
	return f
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTADOR DE LOGGER
// Permite que el pipeline use slog sin importar el paquete slog directamente
// (el pipeline define su propia interfaz mínima de logging).
// ─────────────────────────────────────────────────────────────────────────────

type slogAdapter struct{ logger *slog.Logger }

func (a *slogAdapter) Info(msg string, args ...any)  { a.logger.Info(msg, args...) }
func (a *slogAdapter) Warn(msg string, args ...any)  { a.logger.Warn(msg, args...) }
func (a *slogAdapter) Error(msg string, args ...any) { a.logger.Error(msg, args...) }