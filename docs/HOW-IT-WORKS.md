# DropDeploy -- How It Works

This document explains how DropDeploy works end to end, with a detailed
step-by-step breakdown of the deployment pipeline.

---

## 1. Overview

DropDeploy is a web platform that lets users deploy projects instantly by
pasting a GitHub repository URL. The system:

1. Accepts a GitHub URL, project type, and deploy branch from the user.
2. Queues a deployment job.
3. Clones (or pulls) the repo at the configured branch, builds a Docker image, and starts a container.
4. Returns a live subdomain URL (e.g. `my-app.dropdeploy.app`).
5. Provides an interactive terminal for running commands inside the container.

Two processes run side by side:

| Process | Command | Purpose |
|---------|---------|---------|
| **Next.js app** | `npm run dev` / `npm start` | Serves the UI and API routes |
| **BullMQ worker** | `npm run worker` | Processes deployment jobs in the background |

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Presentation Layer                                          │
│  Next.js App Router + React / shadcn/ui                      │
│  Pages: Landing, Login, Register, Dashboard, Project Detail  │
├──────────────────────────────────────────────────────────────┤
│  Application Layer                                           │
│  API Routes: /api/auth/*, /api/projects/*, /api/health       │
│  Middleware: JWT auth, route protection                       │
├──────────────────────────────────────────────────────────────┤
│  Domain Layer                                                │
│  Services: Auth, Project, Deployment, Docker, Git, Terminal  │
│  Types / DTOs, Zod Validators                                │
├──────────────────────────────────────────────────────────────┤
│  Infrastructure Layer                                        │
│  Prisma (PostgreSQL), BullMQ (Redis),                        │
│  Dockerode, simple-git, Nginx                                │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Database Models

```
User ──(1:N)──▶ Project ──(1:N)──▶ Deployment
```

### User
| Field | Type | Notes |
|-------|------|-------|
| id | cuid | Primary key |
| email | string | Unique |
| passwordHash | string | bcrypt hashed |

### Project
| Field | Type | Notes |
|-------|------|-------|
| id | cuid | Primary key |
| name | string | Display name |
| slug | string | Unique, used as subdomain |
| githubUrl | string | Repository URL |
| type | enum | `STATIC`, `NODEJS`, `NEXTJS`, `DJANGO` |
| branch | string | Git branch to deploy (default: `main`) |
| userId | cuid | Foreign key to User |

### Deployment
| Field | Type | Notes |
|-------|------|-------|
| id | cuid | Primary key |
| status | enum | `QUEUED` → `BUILDING` → `DEPLOYED` / `FAILED` |
| buildStep | string? | Current build phase: `CLONING`, `BUILDING_IMAGE`, `STARTING` |
| containerPort | int | Host port the container is mapped to |
| subdomain | string | Unique, assigned from project slug |
| logs | text | Build/error logs |
| startedAt | DateTime? | When the build began |
| completedAt | DateTime? | When the build finished (success or failure) |
| projectId | cuid | Foreign key to Project |

---

## 4. End-to-End User Flow

### 4.1 Registration & Login

1. User visits `/register` and submits email + password.
2. `POST /api/auth/register` validates input with Zod (`registerSchema`).
3. `AuthService.register()`:
   - Checks email uniqueness via `UserRepository`.
   - Hashes password with `bcryptjs`.
   - Stores user in PostgreSQL via Prisma.
   - Signs a JWT (HS256) with `jose`.
4. JWT is set as an `auth-token` httpOnly cookie via `lib/auth-cookie.ts`.
5. User is redirected to `/dashboard`.

Login follows the same flow but verifies the password instead of creating a user.

Logout clears the `auth-token` cookie via `POST /api/auth/logout`.

Session validation is available via `GET /api/auth/session`.

### 4.2 Project Creation

1. User clicks "New Project" on the dashboard.
2. Fills in: project name, GitHub URL, framework type (Static / Node.js / Next.js / Django), and optionally a branch (defaults to `main`).
3. `POST /api/projects` validates input with Zod (`createProjectSchema`).
4. `ProjectService.create()`:
   - Extracts user session from JWT cookie.
   - Generates a unique slug from the project name.
   - Inserts a `Project` row in PostgreSQL (including branch).
5. Dashboard refreshes and shows the new project tile.

### 4.3 Project Detail

The project detail page has three tabs:

- **Overview** -- Deployment status, live URL, local network URL, deployment history.
- **Settings** -- Edit name, description, framework type, deploy branch, or delete the project.
- **Advanced** -- Container details, interactive terminal, Docker CLI commands reference.

### 4.4 Deployment (detailed below)

User clicks "Deploy" on a project tile. See Section 5.

### 4.5 Interactive Terminal (detailed below)

User runs commands in the deployed container. See Section 6.

---

## 5. Deployment Pipeline -- Step by Step

### Step 1: User triggers deploy

The user clicks "Deploy" on a project tile. The frontend calls:

```
POST /api/projects/:id/deploy
```

**File:** `src/app/api/projects/[id]/deploy/route.ts`

- Extracts user session from JWT cookie via `getSession(req)`.
- Calls `deploymentService.createDeployment(projectId, userId)`.

---

### Step 2: Create deployment record and enqueue job

**File:** `src/services/deployment/deployment.service.ts` -- `createDeployment()`

1. **Look up the project** in PostgreSQL via `projectRepository.findById()`.
2. **Authorize** -- confirms `project.userId === userId` (only the owner can deploy).
3. **Insert a Deployment row** with `status: QUEUED` into PostgreSQL.
4. **Push a job** onto the Redis-backed BullMQ `deployments` queue:
   ```json
   { "deploymentId": "clxyz...", "projectId": "clxyz..." }
   ```
   Queue settings:
   - 3 retry attempts
   - Exponential backoff (2s, 4s, 8s)
   - Keeps last 100 completed jobs
5. **Graceful degradation** -- if Redis is down, the deployment record is still
   created (can be retried later). A warning is logged.
6. **API responds** with `{ deploymentId, message: "Deployment queued." }`.

---

### Step 3: Worker picks up the job

**File:** `src/workers/deployment.worker.ts`

- Runs as a **separate process** via `npm run worker`.
- A BullMQ `Worker` listens on the `deployments` queue.
- **Concurrency: 5** -- up to 5 builds run simultaneously.
- When a job arrives, it calls `deploymentService.buildAndDeploy(deploymentId)`.

---

### Step 4: Clone or update the repository

**File:** `src/services/deployment/deployment.service.ts` -- `buildAndDeploy()`
**File:** `src/services/git/git.service.ts` -- `ensureRepo()`

1. Fetches the deployment + its parent project from the database.
2. Updates deployment status to `BUILDING` and sets `startedAt` timestamp.
3. Updates `buildStep` to `CLONING`.
4. Calls `gitService.ensureRepo(githubUrl, projectSlug, branch)`:
   - **First deploy**: Clones the repo into `PROJECTS_DIR/<project-slug>/` with the target branch.
   - **Subsequent deploys**: Fetches latest changes, updates remote refspec for full branch discovery, unshallows if needed, checks out the target branch, and hard-resets to `origin/<branch>`.
   - Repos persist at `PROJECTS_DIR` (default: `~/.dropdeploy/projects/`) across deployments for faster subsequent builds.

---

### Step 5: Select the Dockerfile template

**File:** `src/services/docker/dockerfile.templates.ts`

Updates `buildStep` to `BUILDING_IMAGE`.

Based on `project.type`, one of four Dockerfile templates is selected:

#### STATIC (Nginx)
```dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```
Copies the project files into Nginx and serves them on port 80.

#### NODEJS
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```
Installs production dependencies and runs `npm start` on port 3000.

#### NEXTJS (multi-stage)
```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "start"]
```
Two-stage build: compiles the Next.js app in the builder stage, then copies
only the build output to a clean runner image. Serves on port 3000.

Note: `nextjs-config-patcher.ts` adjusts Next.js config for standalone output when needed.

#### DJANGO
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
```
Installs Python dependencies from requirements.txt and runs the Django
development server on port 8000.

---

### Step 6: Build the Docker image

**File:** `src/services/docker/docker.service.ts` -- `buildImage()`

1. **Writes the Dockerfile** into the cloned repo directory.
2. **Builds the image** via `dockerode`:
   - Context: the cloned repo directory (all files).
   - Tag: `dropdeploy/<project-slug>:latest`.
3. **Follows the build stream** -- waits for Docker's build output and checks
   for errors in each output chunk.
4. **Verifies the image** -- calls `docker.getImage(imageName).inspect()` to
   confirm it was actually created (Docker can report stream success but fail
   to produce an image).

---

### Step 7: Run the container

**File:** `src/services/docker/docker.service.ts` -- `runContainer()`

Updates `buildStep` to `STARTING`.

1. **Selects the container port**:
   - Static projects: **80** (Nginx)
   - Django: **8000**
   - Node.js / Next.js: **3000**
2. **Picks a host port** -- random port in range **8000--9999**.
3. **Creates the container** with resource limits:
   - Memory: **512 MB** hard limit
   - CPU: **1024 shares** (default weight)
   - Port binding: container port → random host port
4. **Starts the container**.
5. **Returns the host port** (e.g. `8472`).

---

### Step 8: Finalize the deployment

Back in `buildAndDeploy()`:

1. **Clear stale subdomains** -- if this project had a previous deployment
   using the same subdomain, that old deployment's subdomain field is set to
   `null` (the `subdomain` column has a unique constraint).
2. **Update the deployment record**:
   ```
   status:        DEPLOYED
   containerPort: 8472
   subdomain:     my-app
   completedAt:   <current timestamp>
   buildStep:     null (cleared)
   ```
3. **Repo persists** -- the cloned repo directory at `PROJECTS_DIR/<slug>/`
   is kept for faster subsequent deployments (no re-clone needed).

---

### Step 9: Traffic routing

An **Nginx reverse proxy** routes wildcard subdomain traffic to the right
container:

```
User request                  Nginx                         Docker
───────────────────────────────────────────────────────────────────
my-app.dropdeploy.app  ──▶  reverse proxy  ──▶  localhost:8472
                             (subdomain lookup)      (container)
```

The deployed app is now accessible at:
```
https://my-app.dropdeploy.app
```

For local development, the UI also shows a **local network URL** using the
host's detected IP address (e.g. `http://192.168.1.x:8472`), allowing other
devices on the same network to access the deployed app.

---

## 6. Interactive Terminal

After a container is deployed, users can execute commands inside it from the
**Advanced** tab on the project detail page.

### How it works

1. User types a command in the terminal UI (`src/components/features/terminal.tsx`).
2. Frontend calls `POST /api/projects/:id/terminal` with `{ command }`.
3. `DockerTerminalService` resolves the container (by name or image) and runs
   the command via Docker exec.
4. Returns `{ stdout, stderr, exitCode }` to the UI.

### Slash commands

Built-in slash commands provide quick access to container info:

| Command | Description |
|---------|-------------|
| `/show-logs` | Last 500 lines of container logs |
| `/tail-logs` | Last 100 lines of container logs |
| `/env` | Environment variables |
| `/files` | List working directory contents |
| `/help` | Command reference |

### Safety

- Commands are validated against an **allowlist** of permitted tools (ls, cat,
  pwd, echo, env, whoami, df, du, ps, npm, node, python, curl, etc.).
- Each command has a **30-second timeout**.
- Docker's multiplexed stdout/stderr stream is properly demuxed.

### Terminal UI features

- Robbyrussell-style prompt (green/red arrow based on last exit code)
- Command history navigation (arrow keys)
- Slash command autocomplete dropdown
- Resizable terminal height (150--700px drag handle)
- Copy-to-clipboard for commands

---

## 7. Error Handling & Retries

### During deployment

If any step in the pipeline fails (clone, build, or run):

1. Deployment status is set to `FAILED`.
2. `completedAt` timestamp is recorded.
3. The error message is stored in the `logs` column.
4. Common Docker errors are **normalized** to user-friendly messages. For
   example, "no such image" becomes guidance about adding a `start` script.

### BullMQ retries

- Failed jobs are retried up to **3 times**.
- Backoff: **exponential** starting at 2 seconds (2s → 4s → 8s).
- After 3 failures, the job is marked as permanently failed.

### Redis unavailability

- If Redis is down when a deployment is created, the deployment record is
  still written to PostgreSQL (status `QUEUED`).
- The job is not enqueued, but a warning is logged.
- The deployment can be retried when Redis comes back.

---

## 8. Authentication & Authorization

### Authentication

- **JWT-based** using the `jose` library (HS256 algorithm).
- Token is stored in an `auth-token` httpOnly, secure cookie (managed by `lib/auth-cookie.ts`).
- **Middleware** (`src/middleware.ts`) intercepts requests to `/dashboard`
  routes and verifies the JWT.
- Session endpoint (`GET /api/auth/session`) validates the current token.
- Logout (`POST /api/auth/logout`) clears the auth cookie.

### Authorization

- Every API route calls `getSession(req)` (from `lib/get-session.ts`) to extract `userId` from the JWT.
- Services verify **ownership** before allowing actions:
  - `project.userId === session.userId` for project operations.
  - `deployment.project.userId === session.userId` for deployment operations.
- Unauthorized access returns a `404 Not Found` (not `403`) to avoid leaking
  resource existence.

---

## 9. Build Progress Tracking

Deployments now track granular build progress via the `buildStep` field:

```
QUEUED → CLONING → BUILDING_IMAGE → STARTING → DEPLOYED
                                              → FAILED
```

The frontend displays these steps with visual indicators:
- Completed steps show a checkmark
- The active step shows a spinner
- Pending steps show an empty circle

Duration tracking:
- `startedAt` is set when the worker begins processing.
- `completedAt` is set on success or failure.
- The UI shows elapsed time during builds and total duration after completion.

---

## 10. Visual Summary

```
 User clicks "Deploy"
       │
       ▼
 POST /api/projects/:id/deploy
       │
       ▼
 ┌──────────────────────────────┐
 │  DeploymentService           │
 │  1. Verify project ownership │
 │  2. INSERT deployment        │──▶ PostgreSQL  (status: QUEUED)
 │  3. Enqueue job              │──▶ Redis / BullMQ
 └──────────────────────────────┘
       │
       ▼  (async, separate process)
 ┌──────────────────────────────────┐
 │  Worker (concurrency: 5)         │
 │  buildAndDeploy()                │
 │                                  │
 │  4. status → BUILDING            │──▶ PostgreSQL
 │     startedAt → now              │
 │  5. buildStep → CLONING          │
 │     git clone/pull (with branch) │──▶ PROJECTS_DIR/<slug>/
 │  6. buildStep → BUILDING_IMAGE   │
 │     Select Dockerfile + build    │──▶ dropdeploy/my-app:latest
 │  7. buildStep → STARTING         │
 │     docker run                   │──▶ container on port 8472
 │  8. status → DEPLOYED            │──▶ PostgreSQL (subdomain + port)
 │     completedAt → now            │
 └──────────────────────────────────┘
       │
       ▼
 Nginx reverse proxy
 my-app.dropdeploy.app → localhost:8472 → container
       │
       ▼
 Interactive terminal available
 POST /api/projects/:id/terminal → docker exec → stdout/stderr
```

---

## 11. Running Locally

### Prerequisites

- Node.js 18+
- PostgreSQL
- Redis
- Docker daemon running

### Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database URL, Redis host, JWT secret, etc.

# Set up the database
npm run db:push        # Apply schema
npm run db:generate    # Generate Prisma client

# Start the app (two terminals)
npm run dev            # Terminal 1: Next.js dev server
npm run worker         # Terminal 2: BullMQ deployment worker
```

### Key environment variables

| Variable | Example | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/dropdeploy` | PostgreSQL connection |
| `JWT_SECRET` | 32+ character string | JWT signing key |
| `REDIS_HOST` | `localhost` | Redis host for BullMQ |
| `REDIS_PORT` | `6379` | Redis port |
| `BASE_DOMAIN` | `dropdeploy.app` | Subdomain base for deployed apps |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker daemon socket |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Frontend URL |
| `PROJECTS_DIR` | `~/.dropdeploy/projects` | Where cloned repos are stored (default) |
| `DOCKER_DATA_DIR` | `~/.dropdeploy/docker` | Where Docker data is stored (default) |

---

## 12. Tech Stack Summary

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 18, Tailwind CSS, shadcn/ui |
| Backend | Next.js API Routes, Prisma ORM |
| Auth | bcryptjs, jose (JWT HS256) |
| Queue | BullMQ + Redis |
| Containers | dockerode, Nginx reverse proxy |
| Database | PostgreSQL |
| Git | simple-git |
| Validation | Zod, TypeScript strict mode |
