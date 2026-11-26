#!/bin/sh
set -e
echo "Изчакване на файла с адреса на договора: $DEPLOYMENT_FILE"
for i in $(seq 1 60); do
  [ -f "$DEPLOYMENT_FILE" ] && break
  sleep 1
done
if [ "$SEED_DEMO" = "true" ]; then
  node dist/db/seed.js
fi
exec node dist/index.js
