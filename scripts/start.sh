#!/bin/bash
set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env found — copying .env.example"
  cp .env.example .env
  echo "Please fill in your API keys in .env then re-run this script"
  exit 1
fi

echo "Building and starting OutreachPro..."
docker compose up --build
