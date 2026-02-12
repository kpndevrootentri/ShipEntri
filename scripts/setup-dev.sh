#!/usr/bin/env bash
# DropDeploy – development setup (PRD tech stack)

set -e

echo "DropDeploy – dev setup"
echo "Ensure PostgreSQL and Redis are running locally."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example – edit DATABASE_URL and JWT_SECRET."
fi

npm install
npx prisma generate
npx prisma db push --accept-data-loss 2>/dev/null || true

echo "Done. Run: npm run dev (and optionally npm run worker in another terminal)."
