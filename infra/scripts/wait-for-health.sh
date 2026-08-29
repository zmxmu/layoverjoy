#!/bin/bash
# 轮询后端健康端点直至就绪（08 文档 §5）。用法：wait-for-health.sh <base_url> [超时秒]
set -u
BASE="${1:-http://localhost:8080}"
TIMEOUT="${2:-120}"
START=$(date +%s)
while true; do
  if curl -sf -m 5 "$BASE/v1/health" >/dev/null 2>&1; then
    echo "healthy: $BASE"
    exit 0
  fi
  NOW=$(date +%s)
  if [ $((NOW - START)) -ge "$TIMEOUT" ]; then
    echo "timeout: $BASE 未在 ${TIMEOUT}s 内就绪" >&2
    exit 1
  fi
  sleep 3
done
