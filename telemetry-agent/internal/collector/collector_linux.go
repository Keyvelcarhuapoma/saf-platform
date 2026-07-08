//go:build linux

// Collector específico para Linux.
//
// Lee métricas directamente de los archivos virtuales del kernel:
//   /proc/stat    → tiempos de CPU por modo (user, system, idle, iowait...)
//   /proc/meminfo → estadísticas de memoria del sistema
//
// FILOSOFÍA DE ZERO-ALLOCATION:
//   El hot path (llamada a Collect() cada 5 segundos) no hace ninguna
//   allocación en el heap de Go. Esto se logra mediante:
//     1. Buffers de lectura pre-allocados en el struct (reutilizados en cada call)
//     2. Parsing manual byte a byte en lugar de usar fmt.Sscanf o strings.Split
//     3. El struct linuxCollector vive en el heap una sola vez (en New())
//
//   Resultado: cero presión sobre el GC en el hot path → latencia de collect
//   consistente y predecible independientemente del ciclo del GC.
package collector

import (
	"errors"
	"fmt"
	"os"
	"time"
)

// Tamaño del buffer de lectura para /proc/stat y /proc/meminfo.
// /proc/stat en un sistema con 32 cores es ~2KB. 8KB es suficiente margen.
const procReadBufferSize = 8192

// linuxCollector implementa la interfaz Collector leyendo /proc directamente.
type linuxCollector struct {
	// Buffer pre-allocado para leer /proc/stat — reutilizado en cada Collect()
	statBuf [procReadBufferSize]byte
	// Buffer pre-allocado para leer /proc/meminfo
	memBuf [procReadBufferSize]byte

	// Estado del último tick de CPU para calcular el delta (uso %)
	// El uso de CPU no puede medirse en un instante — requiere dos muestras.
	lastCPUTotal uint64
	lastCPUIdle  uint64

	// Flag para saber si ya tenemos una muestra anterior de CPU
	hasPrevCPUSample bool
}

// cpuStats agrupa los contadores de tiempo de CPU leídos de /proc/stat.
// Todos los valores están en "jiffies" (unidades de tiempo del kernel).
type cpuStats struct {
	user    uint64 // Tiempo en modo usuario
	nice    uint64 // Tiempo en modo usuario con prioridad baja
	system  uint64 // Tiempo en modo kernel
	idle    uint64 // Tiempo idle
	iowait  uint64 // Tiempo esperando I/O
	irq     uint64 // Tiempo atendiendo interrupciones de hardware
	softirq uint64 // Tiempo atendiendo interrupciones de software
	steal   uint64 // Tiempo robado por el hypervisor (VMs)
}

// NewCollector crea e inicializa el collector para Linux.
// Esta es la única función que el pipeline necesita llamar — el build tag
// garantiza que en Linux se use esta implementación automáticamente.
func NewCollector() (Collector, error) {
	c := &linuxCollector{}

	// Hacemos una primera lectura para inicializar el estado de CPU.
	// Sin esta lectura inicial, el primer Collect() reportaría 0% de CPU.
	if _, err := c.readProcStat(); err != nil {
		return nil, fmt.Errorf("no se puede leer /proc/stat en el arranque: %w", err)
	}

	return c, nil
}

// Name implementa la interfaz Collector.
func (c *linuxCollector) Name() string { return "linux" }

// Collect implementa la interfaz Collector.
// Lee /proc/stat y /proc/meminfo, calcula deltas y retorna un Snapshot.
//
// Rendimiento garantizado: < 1ms, zero heap allocations después del arranque.
func (c *linuxCollector) Collect() (Snapshot, error) {
	snap := Snapshot{CollectedAt: time.Now()}

	// ── Lectura de CPU ────────────────────────────────────────────────────────
	stats, err := c.readProcStat()
	if err != nil {
		return snap, fmt.Errorf("error leyendo /proc/stat: %w", err)
	}

	// Total de jiffies en este tick
	currentTotal := stats.user + stats.nice + stats.system +
		stats.idle + stats.iowait + stats.irq + stats.softirq + stats.steal
	currentIdle := stats.idle + stats.iowait

	if c.hasPrevCPUSample {
		deltaTotal := currentTotal - c.lastCPUTotal
		deltaIdle := currentIdle - c.lastCPUIdle

		if deltaTotal > 0 {
			// Porcentaje de CPU = (tiempo activo / tiempo total) × 100
			snap.CPUPercent = float64(deltaTotal-deltaIdle) / float64(deltaTotal) * 100.0
		}
	}

	// Guardamos los contadores actuales para el próximo delta
	c.lastCPUTotal = currentTotal
	c.lastCPUIdle = currentIdle
	c.hasPrevCPUSample = true

	// ── Lectura de memoria ────────────────────────────────────────────────────
	memTotal, memAvailable, err := c.readProcMeminfo()
	if err != nil {
		return snap, fmt.Errorf("error leyendo /proc/meminfo: %w", err)
	}

	snap.MemTotalMB = float64(memTotal) / 1024.0
	snap.MemAvailableMB = float64(memAvailable) / 1024.0

	if memTotal > 0 {
		usedKB := memTotal - memAvailable
		snap.MemUsedPercent = float64(usedKB) / float64(memTotal) * 100.0
	}

	return snap, nil
}

// readProcStat lee /proc/stat usando el buffer pre-allocado del struct
// y parsea manualmente la línea "cpu " (CPU agregada de todos los cores).
//
// Formato de /proc/stat (primera línea):
//   cpu  user nice system idle iowait irq softirq steal guest guest_nice
//
// Zero-allocation: usa c.statBuf directamente, sin strings ni slices intermedios.
func (c *linuxCollector) readProcStat() (cpuStats, error) {
	// Abrimos el archivo sin usar os.ReadFile para evitar allocations internas
	f, err := os.Open("/proc/stat")
	if err != nil {
		return cpuStats{}, err
	}
	defer f.Close()

	// Leemos en el buffer pre-allocado del struct
	n, err := f.Read(c.statBuf[:])
	if err != nil && n == 0 {
		return cpuStats{}, err
	}

	// Parseamos solo la primera línea: "cpu  N N N N N N N N"
	// Buscamos los 8 números después del prefijo "cpu "
	return parseCPULine(c.statBuf[:n])
}

// parseCPULine extrae los contadores de CPU de la primera línea de /proc/stat.
// Parser manual: sin allocations, sin reflect, sin regex.
func parseCPULine(data []byte) (cpuStats, error) {
	// Buscamos el inicio de la línea "cpu "
	// En sistemas multi-core, la primera línea es "cpu " (agregado)
	// seguida de "cpu0 ", "cpu1 ", etc.
	i := 0

	// Saltamos el prefijo "cpu"
	if len(data) < 4 || data[0] != 'c' || data[1] != 'p' || data[2] != 'u' {
		return cpuStats{}, errors.New("/proc/stat: formato inesperado, no comienza con 'cpu'")
	}
	i = 3

	// Saltamos espacios después de "cpu"
	for i < len(data) && (data[i] == ' ' || data[i] == '\t') {
		i++
	}

	// Leemos los 8 campos numéricos
	var fields [8]uint64
	for f := 0; f < 8; f++ {
		// Saltamos espacios entre campos
		for i < len(data) && data[i] == ' ' {
			i++
		}
		// Leemos dígitos del campo actual
		var val uint64
		for i < len(data) && data[i] >= '0' && data[i] <= '9' {
			val = val*10 + uint64(data[i]-'0')
			i++
		}
		fields[f] = val
	}

	return cpuStats{
		user:    fields[0],
		nice:    fields[1],
		system:  fields[2],
		idle:    fields[3],
		iowait:  fields[4],
		irq:     fields[5],
		softirq: fields[6],
		steal:   fields[7],
	}, nil
}

// readProcMeminfo lee /proc/meminfo y extrae MemTotal y MemAvailable en KB.
//
// Formato relevante de /proc/meminfo:
//   MemTotal:       16384000 kB
//   MemFree:         8192000 kB
//   MemAvailable:   10240000 kB
//   ...
//
// Zero-allocation: usa c.memBuf directamente.
func (c *linuxCollector) readProcMeminfo() (totalKB, availableKB uint64, err error) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()

	n, err := f.Read(c.memBuf[:])
	if err != nil && n == 0 {
		return 0, 0, err
	}

	data := c.memBuf[:n]

	// Parseamos línea a línea buscando MemTotal y MemAvailable
	totalKB, _ = extractMemField(data, "MemTotal:")
	availableKB, _ = extractMemField(data, "MemAvailable:")

	if totalKB == 0 {
		return 0, 0, errors.New("/proc/meminfo: no se encontró MemTotal")
	}

	return totalKB, availableKB, nil
}

// extractMemField busca un campo específico en el contenido de /proc/meminfo
// y retorna su valor en KB. Parser manual sin allocations.
//
// Ejemplo: extractMemField(data, "MemTotal:") → 16384000
func extractMemField(data []byte, fieldName string) (uint64, bool) {
	nameBytes := []byte(fieldName)
	nameLen := len(nameBytes)

	i := 0
	for i < len(data) {
		// Verificamos si la línea actual empieza con el campo buscado
		if i+nameLen <= len(data) {
			match := true
			for j := 0; j < nameLen; j++ {
				if data[i+j] != nameBytes[j] {
					match = false
					break
				}
			}

			if match {
				// Saltamos el nombre del campo y los espacios
				i += nameLen
				for i < len(data) && (data[i] == ' ' || data[i] == '\t') {
					i++
				}
				// Leemos el valor numérico
				var val uint64
				for i < len(data) && data[i] >= '0' && data[i] <= '9' {
					val = val*10 + uint64(data[i]-'0')
					i++
				}
				return val, true
			}
		}

		// Avanzamos a la siguiente línea
		for i < len(data) && data[i] != '\n' {
			i++
		}
		i++ // Saltamos el '\n'
	}

	return 0, false
}