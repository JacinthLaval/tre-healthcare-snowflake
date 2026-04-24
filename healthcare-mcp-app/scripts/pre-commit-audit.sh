#!/bin/bash
AUDIT_OUTPUT=$(cd "$(git rev-parse --show-toplevel)" && npm audit --audit-level=high 2>&1)
AUDIT_EXIT=$?

if [ $AUDIT_EXIT -ne 0 ]; then
  echo ""
  echo "🔒 npm audit found HIGH/CRITICAL vulnerabilities:"
  echo "$AUDIT_OUTPUT" | tail -20
  echo ""
  echo "Run 'npm audit' for details. Use 'git commit --no-verify' to bypass."
  exit 1
fi
