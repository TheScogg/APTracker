#!/bin/bash
# import.sh - Helper script for running batch schedule imports

# Pre-populated configurations
PLANT="ap4_mnc7kecn"
WORKER_URL="https://press-tracker.f2qnshhgrn.workers.dev"

# Help check
if [ "$1" = "-h" ] || [ "$1" = "--help" ] || [ -z "$1" ]; then
  echo "AP Tracker Batch Import Helper"
  echo "------------------------------"
  echo "Usage:"
  echo "  ./import.sh <directory-path> [options]"
  echo ""
  echo "Examples:"
  echo "  ./import.sh ~/ScheduleScans/ --dry-run"
  echo "  ./import.sh ~/ScheduleScans/ --overwrite"
  echo "  ./import.sh ~/ScheduleScans/ --from-date 2026-06-01 --to-date 2026-06-10"
  exit 0
fi

DIR="$1"
shift # Shift directory argument out so we can pass the remaining flags

node scripts/batch-import-schedules.mjs \
  --dir "$DIR" \
  --plant "$PLANT" \
  --worker-url "$WORKER_URL" \
  "$@"
