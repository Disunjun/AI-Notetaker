#!/bin/sh
# One-shot migration service entrypoint.
#
#   1. wait for PostgreSQL to accept connections
#   2. prisma migrate deploy
#   3. seed (idempotent)
#   4. exit 0 on success, non-zero on any failure
#
# `prisma db push` is never used. web and worker never run migrations.
set -eu

echo "[migrate] waiting for database..."
node --import tsx scripts/wait-for-db.ts

echo "[migrate] applying migrations..."
npx prisma migrate deploy

echo "[migrate] seeding..."
node --import tsx prisma/seed.ts

echo "[migrate] done"
