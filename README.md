# DropDeploy

Deploy projects instantly by **pasting a GitHub repository URL**. The system builds, deploys, and hosts your project and returns a publicly accessible URL.

---

## Features

- **GitHub deployment** – Deploy from a public repository URL (name, framework, optional description)
- **Automatic project type detection** – Static (HTML), Node.js, or Next.js based on file presence
- **Containerized build & runtime** – Each deployment runs in an isolated Docker container
- **Live deployment URL** – Subdomain per project (e.g. `https://{slug}.dropdeploy.app`)
- **Build status & logs** – Real-time build progress and persisted logs
- **Authentication** – Email/password sign up and login with JWT sessions

---

## Tech Stack

| Layer | Technologies |
|-------|---------------|
| **Frontend** | Next.js (App Router), React, shadcn/ui, Tailwind CSS |
| **Backend** | Next.js API Routes, Prisma ORM, PostgreSQL, Redis, BullMQ |
| **Infrastructure** | Docker, Nginx (reverse proxy) |

---

## Prerequisites

- **Node.js** 18+
- **PostgreSQL** (local or remote)
- **Redis** (for BullMQ job queue)
- **Docker** (optional for MVP; required for full build/deploy)

---

## Getting Started

### 1. Clone and install

```bash
git clone <repository-url>
cd dropDeploy
npm install
```

### 2. Environment variables

Copy the example env file and set your values:

```bash
cp .env.example .env
```

Edit `.env` and configure at least:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgresql://user:password@localhost:5432/dropdeploy`) |
| `JWT_SECRET` | Secret for JWT signing (min 32 chars recommended for production) |
| `REDIS_HOST` / `REDIS_PORT` | Redis connection (defaults: `localhost`, `6379`) |

See [.env.example](.env.example) for all options.

### 3. Database setup

Create the database (if it doesn’t exist), then apply the schema:

```bash
# Create DB (example; use your DB user)
createdb dropdeploy

# If your DB user needs schema permissions (e.g. "permission denied for schema public"):
psql -d dropdeploy -f scripts/fix-db-permissions.sql

# Apply Prisma schema
npx prisma generate
npx prisma db push
```

For migrations instead of push:

```bash
npx prisma migrate dev
```

### 4. Run the app

**Development:**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign up or log in to access the dashboard.

**Optional – deployment worker** (processes build jobs; requires Redis):

```bash
npm run worker
```

**Production build:**

```bash
npm run build
npm start
```

---

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run type-check` | Run TypeScript check |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:push` | Push schema to DB (no migrations) |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:studio` | Open Prisma Studio |
| `npm run worker` | Start deployment queue worker |

---

## Project Structure

```
dropDeploy/
├── src/
│   ├── app/              # Next.js App Router (auth, dashboard, api)
│   ├── components/       # UI (shadcn), features, layouts
│   ├── lib/              # Utils, Prisma, Redis, queue, auth-cookie
│   ├── repositories/     # Data access (User, Project, Deployment)
│   ├── services/         # Business logic (auth, project, deployment, docker)
│   ├── types/            # Shared TypeScript types
│   ├── validators/       # Zod schemas
│   └── workers/          # BullMQ deployment worker
├── prisma/
│   └── schema.prisma    # Database schema
├── docker/              # Nginx configs, Dockerfile templates
├── scripts/             # Dev setup, DB permissions
└── docs/                # PRD, architecture
```

For a detailed breakdown, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes (auth) | Secret for JWT; use a long random string in production |
| `JWT_EXPIRES_IN` | No | Token expiry (e.g. `7d`); default `7d` |
| `REDIS_HOST` | No | Redis host; default `localhost` |
| `REDIS_PORT` | No | Redis port; default `6379` |
| `NEXT_PUBLIC_APP_URL` | No | Public app URL for links |
| `BASE_DOMAIN` | No | Base domain for deployment URLs |
| `DOCKER_SOCKET` | No | Docker socket path (for build/deploy) |
| `NGINX_CONFIG_PATH` | No | Nginx config path for subdomain routing |

---

## What happens after you add a project

1. **Create project** – You provide a name, GitHub repo URL, and framework. A project and (on Deploy) a deployment record are created (status `QUEUED`).
2. **Deploy** – Click “Deploy to get link” on a project tile. A job is added to BullMQ (requires Redis). If Redis is not running, the deployment is still created; start Redis and the worker to process it later.
3. **Worker** – Run `npm run worker` (with Redis running). The worker picks up jobs and runs the build step.
4. **Build & live URL** – The Docker build/run step is not implemented yet. See **[docs/NEXT-STEPS.md](docs/NEXT-STEPS.md)** for what to implement next (DockerService + `buildAndDeploy`) to get a live URL.

---

## Documentation

- **[docs/PRD.md](docs/PRD.md)** – Product requirements, user stories, and functional specs
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** – Layered architecture and folder structure
- **[docs/NEXT-STEPS.md](docs/NEXT-STEPS.md)** – What happens after you add a project and what to implement next

---

## License

Private / unlicensed unless otherwise specified.
