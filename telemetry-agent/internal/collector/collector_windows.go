//go:build windows

package collector

import (
	"fmt"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

type windowsCollector struct {
	lastIdleTime     uint64
	lastKernelTime   uint64
	lastUserTime     uint64
	hasPrevCPUSample bool
}

type memoryStatusEx struct {
	dwLength                uint32
	dwMemoryLoad            uint32
	ullTotalPhys            uint64
	ullAvailPhys            uint64
	ullTotalPageFile        uint64
	ullAvailPageFile        uint64
	ullTotalVirtual         uint64
	ullAvailVirtual         uint64
	ullAvailExtendedVirtual uint64
}

var (
	modKernel32              = windows.NewLazySystemDLL("kernel32.dll")
	procGetSystemTimes       = modKernel32.NewProc("GetSystemTimes")
	procGlobalMemoryStatusEx = modKernel32.NewProc("GlobalMemoryStatusEx")
)

func NewCollector() (Collector, error) {
	c := &windowsCollector{}

	// Primera lectura solo para establecer el baseline — resultado descartado
	// intencionalmente porque sin muestra anterior el delta es inválido
	if _, err := c.sampleCPU(); err != nil {
		return nil, fmt.Errorf("GetSystemTimes no disponible en el arranque: %w", err)
	}
	return c, nil
}

func (c *windowsCollector) Name() string { return "windows" }

// Collect implementa la interfaz Collector.
// Ahora es el único punto de control del flujo completo — lee CPU y memoria
// y asigna TODOS los valores al Snapshot antes de retornarlo.
func (c *windowsCollector) Collect() (Snapshot, error) {
	snap := Snapshot{CollectedAt: time.Now()}

	// ── CPU ───────────────────────────────────────────────────────────────────
	cpuPercent, err := c.sampleCPU()
	if err != nil {
		return snap, fmt.Errorf("error leyendo CPU via GetSystemTimes: %w", err)
	}
	// Asignación directa — el valor llega al Snapshot garantizadamente
	snap.CPUPercent = cpuPercent

	// ── Memoria ───────────────────────────────────────────────────────────────
	var memStatus memoryStatusEx
	memStatus.dwLength = uint32(unsafe.Sizeof(memStatus))

	ret, _, err := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&memStatus)))
	if ret == 0 {
		return snap, fmt.Errorf("GlobalMemoryStatusEx falló: %w", err)
	}

	snap.MemTotalMB = float64(memStatus.ullTotalPhys) / 1_048_576.0
	snap.MemAvailableMB = float64(memStatus.ullAvailPhys) / 1_048_576.0
	snap.MemUsedPercent = float64(memStatus.dwMemoryLoad)

	return snap, nil
}

// sampleCPU llama GetSystemTimes, calcula el delta contra la muestra anterior
// y retorna el porcentaje de CPU usado. En la primera llamada retorna 0.0
// (sin baseline no hay delta válido) y establece el estado inicial.
//
// A diferencia de la versión anterior, esta función retorna el valor calculado
// en lugar de descartarlo — ese era el bug central.
func (c *windowsCollector) sampleCPU() (float64, error) {
	var idleTime, kernelTime, userTime windows.Filetime

	ret, _, err := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idleTime)),
		uintptr(unsafe.Pointer(&kernelTime)),
		uintptr(unsafe.Pointer(&userTime)),
	)
	if ret == 0 {
		return 0, fmt.Errorf("GetSystemTimes retornó error: %w", err)
	}

	currentIdle := filetimeToUint64(idleTime)
	currentKernel := filetimeToUint64(kernelTime)
	currentUser := filetimeToUint64(userTime)

	var cpuPercent float64

	if c.hasPrevCPUSample {
		// kernelTime en Windows incluye idleTime — debemos substraerlo
		deltaKernel := currentKernel - c.lastKernelTime
		deltaUser := currentUser - c.lastUserTime
		deltaIdle := currentIdle - c.lastIdleTime

		totalActive := deltaKernel + deltaUser
		if totalActive > 0 {
			// CPU usada = tiempo total activo MENOS el tiempo idle dentro de kernel
			cpuUsed := totalActive - deltaIdle
			cpuPercent = float64(cpuUsed) / float64(totalActive) * 100.0
		}
	}

	// Actualizamos el estado para el próximo delta
	c.lastIdleTime = currentIdle
	c.lastKernelTime = currentKernel
	c.lastUserTime = currentUser
	c.hasPrevCPUSample = true

	return cpuPercent, nil
}

// filetimeToUint64 convierte windows.Filetime a uint64 para aritmética de deltas.
func filetimeToUint64(ft windows.Filetime) uint64 {
	return uint64(ft.HighDateTime)<<32 | uint64(ft.LowDateTime)
}
