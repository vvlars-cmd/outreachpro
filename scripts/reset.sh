#!/bin/bash
set -e
cd "$(dirname "$0")/.."
echo "Stopping containers..."
docker compose down
echo "Removing data volume..."
docker volume rm outreachpro_outreachpro_data 2>/dev/null || true
echo "Removing image..."
docker rmi outreachpro-outreachpro 2>/dev/null || true
echo "Reset complete."
