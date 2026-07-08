// Paquete ringbuffer implementa un buffer circular (ring buffer / circular queue)
// thread-safe para el pipeline de telemetría del S.A.F. Telemetry Agent.
//
// DISEÑO:
//   El ring buffer es la pieza central del patrón pipeline no-bloqueante.
//   Separa el goroutine de recolección del goroutine de escritura a InfluxDB,
//   garantizando que el colector NUNCA se bloquee, incluso si InfluxDB está caído.
//
// SEMÁNTICA DE OVERFLOW (FIFO Drop):
//   Cuando el buffer está lleno, Push() descarta el elemento MÁS ANTIGUO
//   (el que está en la cabeza del queue) antes de insertar el nuevo.
//   Esto garantiza que el agente siempre trabaja con datos frescos y nunca
//   reporta métricas obsoletas cuando InfluxDB se recupera.
//
// THREAD-SAFETY:
//   Un mutex protege todas las operaciones. La contención es mínima porque
//   Push() es llamado cada 5s por un solo goroutine y Pop()/PopBatch()
//   es llamado cada 10-15s por otro goroutine. No hay contención real
//   en condiciones normales.
//
// ZERO-ALLOCATION en hot path:
//   El slice interno `buf` es allocado una sola vez en New().
//   Push() y Pop() solo modifican índices enteros — no hay allocations.
//   PopBatch() retorna un slice de capacidad pre-conocida que el caller
//   es responsable de reutilizar.
package ringbuffer

import (
	"sync"
	"sync/atomic"

	"github.com/saf-platform/telemetry-agent/internal/collector"
)

// RingBuffer es un buffer circular thread-safe de Snapshots.
type RingBuffer struct {
	buf      []collector.Snapshot // Slice de capacidad fija — allocado una sola vez
	capacity int                  // Capacidad máxima del buffer
	head     int                  // Índice del próximo elemento a leer (Pop)
	tail     int                  // Índice donde se escribirá el próximo elemento (Push)
	count    int                  // Número de elementos actualmente en el buffer
	mu       sync.Mutex           // Mutex que protege head, tail, count

	// DroppedTotal es el contador acumulado de puntos descartados por overflow.
	// Usamos atomic para poder leerlo desde el goroutine de métricas internas
	// sin tomar el mutex (lectura concurrente segura desde múltiples goroutines).
	DroppedTotal atomic.Int64
}

// New crea un nuevo RingBuffer con la capacidad especificada.
// La capacidad debe ser mayor que 0 — en caso contrario entra en pánico.
func New(capacity int) *RingBuffer {
	if capacity <= 0 {
		panic("ringbuffer: la capacidad debe ser mayor que 0")
	}
	return &RingBuffer{
		buf:      make([]collector.Snapshot, capacity),
		capacity: capacity,
	}
}

// Push inserta un Snapshot en el buffer.
// Si el buffer está lleno, descarta el elemento más antiguo (FIFO drop)
// e incrementa el contador DroppedTotal.
//
// Esta operación es O(1) y nunca bloquea al caller más allá del tiempo
// de adquisición del mutex (microsegundos).
func (r *RingBuffer) Push(snap collector.Snapshot) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.count == r.capacity {
		// Buffer lleno — descartamos el elemento más antiguo (FIFO)
		// Avanzamos head para "liberar" el slot más antiguo
		r.head = (r.head + 1) % r.capacity
		r.count--
		// Incrementamos el contador de drops de forma atómica
		r.DroppedTotal.Add(1)
	}

	// Escribimos en la posición tail y avanzamos tail
	r.buf[r.tail] = snap
	r.tail = (r.tail + 1) % r.capacity
	r.count++
}

// Pop extrae y retorna el elemento más antiguo del buffer.
// Retorna (Snapshot, true) si había elementos, (zero, false) si estaba vacío.
//
// Esta operación es O(1).
func (r *RingBuffer) Pop() (collector.Snapshot, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.count == 0 {
		return collector.Snapshot{}, false
	}

	snap := r.buf[r.head]
	r.head = (r.head + 1) % r.capacity
	r.count--
	return snap, true
}

// PopBatch extrae hasta `maxItems` elementos del buffer y los retorna.
// Si el buffer tiene menos elementos que maxItems, retorna todos los disponibles.
//
// El slice retornado es allocado por PopBatch. Para zero-allocation,
// el caller puede pasar un slice pre-allocado via PopBatchInto.
//
// Esta operación es O(n) donde n = min(maxItems, count).
func (r *RingBuffer) PopBatch(maxItems int) []collector.Snapshot {
	r.mu.Lock()
	defer r.mu.Unlock()

	available := r.count
	if available == 0 {
		return nil
	}

	toExtract := maxItems
	if available < maxItems {
		toExtract = available
	}

	batch := make([]collector.Snapshot, toExtract)
	for i := 0; i < toExtract; i++ {
		batch[i] = r.buf[r.head]
		r.head = (r.head + 1) % r.capacity
		r.count--
	}

	return batch
}

// Len retorna el número de elementos actualmente en el buffer.
// Thread-safe.
func (r *RingBuffer) Len() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.count
}

// Capacity retorna la capacidad máxima del buffer.
// Inmutable después de New() — no necesita mutex.
func (r *RingBuffer) Capacity() int {
	return r.capacity
}

// IsFull retorna true si el buffer está completamente lleno.
// Thread-safe.
func (r *RingBuffer) IsFull() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.count == r.capacity
}