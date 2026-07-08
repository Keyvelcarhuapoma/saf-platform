#!/bin/bash
# S.A.F. — Verificación del stack completo antes de arrancar el dashboard

set -e

echo "Verificando S.A.F. Stack..."

check_service() {
  local name=$1
  local url=$2
  local status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$url")
  if [ "$status" = "200" ]; then
    echo "  ✓ $name → $url (HTTP $status)"
  else
    echo "  ✗ $name → $url (HTTP $status) — SERVICIO NO DISPONIBLE"
    exit 1
  fi
}

check_service "Target Server"     "http://localhost:3001/health"
check_service "Predictive Engine" "http://localhost:8000/health"
check_service "CORS preflight"    "http://localhost:8000/api/v1/predict/ttf"

echo ""
echo "Stack S.A.F. operativo. Iniciando NOC Dashboard..."
npm run dev