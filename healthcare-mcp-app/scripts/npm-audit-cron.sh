#!/bin/bash
set -euo pipefail

PROJECT_DIR="/Users/toddcrosslin/Downloads/CoCoStuff/healthcare-mcp-app"
LOG_DIR="$PROJECT_DIR/audit-logs"
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
LOG_FILE="$LOG_DIR/npm-audit-$TIMESTAMP.json"
SUMMARY_FILE="$LOG_DIR/npm-audit-$TIMESTAMP.txt"

mkdir -p "$LOG_DIR"

cd "$PROJECT_DIR"

npm audit --json > "$LOG_FILE" 2>&1 || true

TOTAL=$(node -e "const r=require('$LOG_FILE'); console.log(r.metadata?.vulnerabilities?.total || 0)")
HIGH=$(node -e "const r=require('$LOG_FILE'); console.log((r.metadata?.vulnerabilities?.high || 0) + (r.metadata?.vulnerabilities?.critical || 0))")

{
  echo "npm audit — $TIMESTAMP"
  echo "========================"
  echo "Total vulnerabilities: $TOTAL"
  echo "High/Critical: $HIGH"
  echo ""
  npm audit 2>&1 || true
} > "$SUMMARY_FILE"

if [ "$HIGH" -gt 0 ]; then
  echo "⚠️  [$TIMESTAMP] $HIGH high/critical vulnerabilities found. See $SUMMARY_FILE"
  osascript -e "display notification \"$HIGH high/critical npm vulnerabilities found\" with title \"npm Audit\" sound name \"Basso\"" 2>/dev/null || true
elif [ "$TOTAL" -gt 0 ]; then
  echo "ℹ️  [$TIMESTAMP] $TOTAL vulnerabilities (none high/critical). See $SUMMARY_FILE"
else
  echo "✅ [$TIMESTAMP] No vulnerabilities found."
fi

find "$LOG_DIR" -name "npm-audit-*.json" -mtime +30 -delete 2>/dev/null || true
find "$LOG_DIR" -name "npm-audit-*.txt" -mtime +30 -delete 2>/dev/null || true
