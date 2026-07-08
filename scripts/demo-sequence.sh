#!/bin/bash
# S.A.F. — Secuencia de demostración p
# Prerequisito: Target Server, Telemetry Agent y Predictive Engine corriendo

set -e

ENGINE_URL="http://localhost:8000"
TARGET_URL="http://localhost:3001"

echo ""
echo "══════════════════════════════════════════════════"
echo "  S.A.F. — DEMO MODE — Secuencia de tesis"
echo "══════════════════════════════════════════════════"

# ── Paso 1: Verificar stack ───────────────────────────────────────────────────
echo ""
echo "[1/4] Verificando stack..."
curl -sf "$TARGET_URL/health"  > /dev/null && echo "  ✓ Target Server"  || { echo "  ✗ Target Server NO responde"; exit 1; }
curl -sf "$ENGINE_URL/health"  > /dev/null && echo "  ✓ Predictive Engine" || { echo "  ✗ Engine NO responde"; exit 1; }

# ── Paso 2: Reset del servidor para baseline limpio ───────────────────────────
echo ""
echo "[2/4] Reseteando estado del servidor para baseline limpio..."
curl -sf -X POST "$TARGET_URL/api/reset" | python -m json.tool
echo "  Esperando 30s para que el engine establezca baseline..."
sleep 30

# ── Paso 3: Estado HEALTHY visible ───────────────────────────────────────────
echo ""
echo "[3/4] Estado actual del engine (debe ser HEALTHY o DEGRADING):"
curl -sf "$ENGINE_URL/api/v1/predict/ttf" | python -m json.tool

# ── Paso 4: Lanzar caos controlado ───────────────────────────────────────────
echo ""
echo "[4/4] Lanzando ataque de caos — el sistema entrará en CRITICAL en ~2-3 minutos"
echo "      Observa el NOC Dashboard en http://localhost:3000"
echo ""
echo "  Presiona Ctrl+C para detener el caos cuando el jurado haya visto el CRITICAL."
echo ""

cd "$(dirname "$0")/../load-tester"
k6 run -e TARGET_URL="$TARGET_URL" \
       --duration 8m \
       --vus 50 \
       scenarios/chaos_injection.js