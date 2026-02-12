# How It Works

> End-to-end explanation of DropDeploy's runtime behavior.
> For code structure and conventions, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 1. Overview

DropDeploy lets users deploy projects instantly by pasting a GitHub repository URL. The system clones the repo, builds a Docker image, starts a container, and returns a live subdomain URL.

```mermaid
graph LR
    A[Paste GitHub URL] --> B[Queue Job]
    B --> C[Clone Repo]
    C --> D[Build Docker Image]
    D --> E[Start Container]
    E --> F[Live URL Ready]

    style A fill:#e0f2fe
    style F fill:#dcfce7
```

**Two processes run side by side:**

| Process | Command | Purpose |
|---------|---------|---------|
| **Next.js app** | `npm run dev` / `npm start` | UI + API routes |
| **BullMQ worker** | `npm run worker` | Background deployment jobs |

---

## 2. System Architecture

```mermaid
graph TB
    subgraph Client["Browser"]
        UI[React UI + shadcn/ui]
    end

    subgraph Server["Next.js Server"]
        API[API Routes]
        MW[Middleware — JWT]
        SVC[Services]
    end

    subgraph Worker["Worker Process"]
        BW[BullMQ Worker]
    end

    subgraph External["Infrastructure"]
        PG[(PostgreSQL)]
        RD[(Redis)]
        DK[Docker Engine]
        NG[Nginx Proxy]
    end

    UI -->|HTTP| API
    API --> MW
    API --> SVC
    SVC --> PG
    SVC -->|enqueue| RD
    RD -->|dequeue| BW
    BW --> SVC
    SVC --> DK
    NG -->|route traffic| DK
    UI -.->|subdomain| NG
```

---

## 3. Database Models

```mermaid
erDiagram
    User ||--o{ Project : owns
    Project ||--o{ Deployment : has

    User {
        string id PK "cuid"
        string email UK
        string passwordHash "bcrypt"
        datetime createdAt
    }

    Project {
        string id PK "cuid"
        string name
        string slug UK "used as subdomain"
        string githubUrl
        enum type "STATIC | NODEJS | NEXTJS | DJANGO"
        string branch "default: main"
        string userId FK
    }

    Deployment {
        string id PK "cuid"
        enum status "QUEUED | BUILDING | DEPLOYED | FAILED"
        string buildStep "CLONING | BUILDING_IMAGE | STARTING"
        int containerPort "host port 8000-9999"
        string subdomain UK
        text logs
        datetime startedAt
        datetime completedAt
        string projectId FK
    }
```

---

## 4. User Flows

### 4.1 Registration & Login

```mermaid
sequenceDiagram
    actor U as User
    participant P as /register page
    participant API as POST /api/auth/register
    participant AS as AuthService
    participant DB as PostgreSQL

    U->>P: Fill email + password
    P->>API: POST { email, password }
    API->>API: Zod validate (registerSchema)
    API->>AS: register(email, password)
    AS->>AS: bcrypt.hash(password)
    AS->>DB: INSERT user
    AS->>AS: sign JWT (jose, HS256)
    AS-->>API: { accessToken, user }
    API->>API: setAuthCookie(httpOnly)
    API-->>P: 201 Created
    P->>P: redirect to /dashboard
```

Login follows the same flow but verifies the password instead of creating a user. Logout clears the `auth-token` cookie via `POST /api/auth/logout`.

### 4.2 Project Creation

1. User clicks **"New Project"** on the dashboard.
2. Fills in: project name, GitHub URL, framework type, and optionally a branch (defaults to `main`).
3. `POST /api/projects` validates input with Zod (`createProjectSchema`).
4. `ProjectService.create()` generates a unique slug and inserts a `Project` row.
5. Dashboard refreshes to show the new project tile.

### 4.3 Project Detail Page

The project detail page has **three tabs**:

| Tab | Contents |
|-----|----------|
| **Overview** | Deployment status, live URL, local network URL, deployment history |
| **Settings** | Edit name, description, framework type, deploy branch, or delete the project |
| **Advanced** | Container details, interactive terminal, Docker CLI commands reference |

---

## 5. Deployment Pipeline

This is the core of DropDeploy. When a user clicks **"Deploy"**, the following 9-step pipeline executes:

```mermaid
flowchart TB
    T["User clicks Deploy"] --> S1

    subgraph API["API Layer (synchronous)"]
        S1["Step 1: POST /api/projects/:id/deploy"]
        S1 --> S2["Step 2: Create deployment record (QUEUED) + enqueue job"]
    end

    S2 -->|async via Redis| S3

    subgraph WK["Worker Process (asynchronous)"]
        S3["Step 3: Worker picks up job"]
        S3 --> S4["Step 4: Clone or update repo"]
        S4 --> S5["Step 5: Select Dockerfile template"]
        S5 --> S6["Step 6: Build Docker image"]
        S6 --> S7["Step 7: Run container"]
        S7 --> S8["Step 8: Finalize deployment"]
    end

    S8 --> S9["Step 9: Nginx routes traffic to container"]
    S9 --> LIVE["Live at my-app.dropdeploy.app"]

    style T fill:#e0f2fe
    style LIVE fill:#dcfce7
```

### Step 1: Trigger deploy

**File:** `src/app/api/projects/[id]/deploy/route.ts`

- Extracts user session from JWT cookie via `getSession(req)`.
- Calls `deploymentService.createDeployment(projectId, userId)`.

### Step 2: Create record & enqueue

**File:** `src/services/deployment/deployment.service.ts` -- `createDeployment()`

1. Looks up the project via `projectRepository.findById()`.
2. Authorizes -- confirms `project.userId === userId`.
3. Inserts a `Deployment` row with `status: QUEUED`.
4. Pushes a job onto the BullMQ `deployments` queue:
   ```json
   { "deploymentId": "clxyz...", "projectId": "clxyz..." }
   ```
5. **Queue settings:** 3 retry attempts, exponential backoff (2s, 4s, 8s), keeps last 100 completed jobs.
6. **Graceful degradation:** If Redis is down, the deployment record is still created and can be retried later.

### Step 3: Worker picks up the job

**File:** `src/workers/deployment.worker.ts`

- Runs as a **separate process** via `npm run worker`.
- BullMQ `Worker` listens on the `deployments` queue.
- **Concurrency: 5** -- up to 5 builds run simultaneously.
- Calls `deploymentService.buildAndDeploy(deploymentId)`.

### Step 4: Clone or update repo

**File:** `src/services/git/git.service.ts` -- `ensureRepo()`

```mermaid
flowchart TD
    A{Repo exists locally?}
    A -->|No| B[git clone URL -b branch]
    A -->|Yes| C[git fetch origin]
    C --> D[Update refspec for full branch discovery]
    D --> E{Shallow clone?}
    E -->|Yes| F[git fetch --unshallow]
    E -->|No| G[git checkout branch]
    F --> G
    G --> H[git reset --hard origin/branch]
    B --> I[Repo ready]
    H --> I
```

- **First deploy:** Clones into `PROJECTS_DIR/<slug>/` (default: `~/.dropdeploy/projects/`).
- **Subsequent deploys:** Fetches latest, switches branch if needed, hard-resets to `origin/<branch>`.
- Repos persist across deployments for faster subsequent builds.

### Step 5: Select Dockerfile template

**File:** `src/services/docker/dockerfile.templates.ts`

Updates `buildStep` to `BUILDING_IMAGE`. Based on `project.type`, one of four templates is used:

| Type | Base Image | Internal Port | Strategy |
|------|-----------|--------------|----------|
| **STATIC** | `nginx:alpine` | 80 | Copy files into Nginx html directory |
| **NODEJS** | `node:18-alpine` | 3000 | `npm install --omit=dev` + `npm start` |
| **NEXTJS** | `node:18-alpine` | 3000 | Multi-stage build (builder + runner) |
| **DJANGO** | `python:3.12-slim` | 8000 | `pip install -r requirements.txt` + `manage.py runserver` |

> **Note:** `nextjs-config-patcher.ts` adjusts Next.js config for standalone output when needed.

### Step 6: Build Docker image

**File:** `src/services/docker/docker.service.ts` -- `buildImage()`

1. Writes the Dockerfile into the cloned repo directory.
2. Builds via `dockerode` with tag `dropdeploy/<slug>:latest`.
3. Follows the build stream and checks for errors in each output chunk.
4. Verifies the image exists via `docker.getImage(tag).inspect()`.

### Step 7: Run container

**File:** `src/services/docker/docker.service.ts` -- `runContainer()`

Updates `buildStep` to `STARTING`.

1. Selects the internal container port based on project type (80 / 3000 / 8000).
2. Picks a random **host port** in range **8000--9999**.
3. Creates the container with resource limits:
   - **Memory:** 512 MB hard limit
   - **CPU:** 1024 shares (default weight)
   - Port binding: container port → random host port
4. Starts the container.

### Step 8: Finalize deployment

Back in `buildAndDeploy()`:

1. Clears stale subdomains (previous deployment's subdomain set to `null` due to unique constraint).
2. Updates the deployment record:
   - `status: DEPLOYED`
   - `containerPort: <assigned port>`
   - `subdomain: <project-slug>`
   - `completedAt: <timestamp>`
   - `buildStep: null` (cleared)

### Step 9: Traffic routing

```mermaid
graph LR
    U["User Browser"] -->|"my-app.dropdeploy.app"| NG["Nginx Reverse Proxy"]
    NG -->|"localhost:8472"| C["Docker Container"]

    style U fill:#e0f2fe
    style C fill:#dcfce7
```

Nginx routes wildcard subdomain traffic to the correct container port. The app is accessible at `https://<slug>.dropdeploy.app`.

For local development, the UI also shows a **local network URL** (e.g., `http://192.168.1.x:8472`) so other devices on the same network can access the deployed app.

---

## 6. Build Progress Tracking

Deployments track granular progress via the `buildStep` field:

```mermaid
stateDiagram-v2
    [*] --> QUEUED
    QUEUED --> CLONING: Worker picks up job
    CLONING --> BUILDING_IMAGE: Repo ready
    BUILDING_IMAGE --> STARTING: Image built
    STARTING --> DEPLOYED: Container running
    CLONING --> FAILED: Clone error
    BUILDING_IMAGE --> FAILED: Build error
    STARTING --> FAILED: Container error
    FAILED --> [*]
    DEPLOYED --> [*]
```

**Frontend indicators:**
- Completed steps: checkmark
- Active step: spinner
- Pending steps: empty circle

**Duration tracking:**
- `startedAt` set when worker begins processing
- `completedAt` set on success or failure
- UI shows elapsed time during builds, total duration after completion

---

## 7. Interactive Terminal

After deployment, users can execute commands inside the container from the **Advanced** tab.

```mermaid
sequenceDiagram
    actor U as User
    participant T as Terminal UI
    participant API as POST /terminal
    participant DTS as DockerTerminalService
    participant D as Docker Engine

    U->>T: Type command
    T->>API: { command: "ls -la" }
    API->>DTS: executeCommand(projectId, "ls -la")
    DTS->>DTS: Validate against allowlist
    DTS->>D: docker exec (create + start)
    D-->>DTS: Multiplexed stream
    DTS->>DTS: Demux stdout/stderr
    DTS-->>API: { stdout, stderr, exitCode }
    API-->>T: Display output
```

### Slash Commands

| Command | Description |
|---------|-------------|
| `/show-logs` | Last 500 lines of container logs |
| `/tail-logs` | Last 100 lines of container logs |
| `/env` | Environment variables |
| `/files` | List working directory contents |
| `/help` | Command reference |

### Safety

- Commands validated against an **allowlist** (ls, cat, pwd, echo, env, npm, node, python, curl, etc.).
- **30-second timeout** per command.
- Docker's multiplexed stdout/stderr stream is properly demuxed.

### Terminal UI Features

- Robbyrussell-style prompt (green/red arrow based on last exit code)
- Command history navigation (arrow keys)
- Slash command autocomplete dropdown
- Resizable terminal height (150--700px drag handle)
- Copy-to-clipboard for commands

---

## 8. Error Handling & Retries

### Deployment Failures

If any pipeline step fails (clone, build, or run):

1. Status set to `FAILED`, `completedAt` recorded.
2. Error message stored in the `logs` column.
3. Common Docker errors **normalized** to user-friendly messages (e.g., "no such image" becomes guidance about adding a `start` script).

### BullMQ Retry Strategy

```mermaid
graph LR
    F1["Attempt 1 fails"] -->|2s backoff| F2["Attempt 2"]
    F2 -->|4s backoff| F3["Attempt 3"]
    F3 -->|8s backoff| F4["Attempt 4 (final)"]
    F4 -->|still fails| PERM["Permanently failed"]

    style PERM fill:#fee2e2
```

- **3 retries** with exponential backoff starting at 2 seconds.
- After all retries exhausted, the job is marked as permanently failed.

### Redis Unavailability

- Deployment record is still written to PostgreSQL (status: `QUEUED`).
- Job is **not** enqueued — a warning is logged.
- Can be retried when Redis recovers.

---

## 9. Authentication & Authorization

### Authentication Flow

```mermaid
flowchart LR
    subgraph Registration
        R1[Email + Password] --> R2[Zod Validate]
        R2 --> R3[bcrypt Hash]
        R3 --> R4[Store in DB]
        R4 --> R5[Sign JWT]
        R5 --> R6[Set httpOnly Cookie]
    end

    subgraph "Every Request"
        E1[Cookie sent] --> E2[Middleware extracts JWT]
        E2 --> E3[jose.verify]
        E3 -->|Valid| E4["getSession() → { userId }"]
        E3 -->|Invalid| E5[Redirect to /login]
    end
```

- **JWT-based** using `jose` (HS256 algorithm).
- Token stored in `auth-token` httpOnly, secure cookie.
- **Middleware** (`src/middleware.ts`) protects `/dashboard/*` routes.
- Session endpoint: `GET /api/auth/session`.
- Logout: `POST /api/auth/logout` clears the cookie.

### Authorization

- Every API route calls `getSession(req)` to extract `userId`.
- Services verify **ownership**: `resource.userId === session.userId`.
- Unauthorized access returns **404** (not 403) to avoid leaking resource existence.

---

## 10. API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Login |
| `POST` | `/api/auth/logout` | Logout (clear cookie) |
| `GET` | `/api/auth/session` | Validate current session |
| `GET` | `/api/projects` | List user's projects |
| `POST` | `/api/projects` | Create project |
| `GET` | `/api/projects/:id` | Get project details |
| `PATCH` | `/api/projects/:id` | Update project |
| `DELETE` | `/api/projects/:id` | Delete project |
| `POST` | `/api/projects/:id/deploy` | Trigger deployment |
| `POST` | `/api/projects/:id/terminal` | Execute container command |
| `GET` | `/api/health` | Health check |

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

### Environment Variables

| Variable | Example | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/dropdeploy` | PostgreSQL connection |
| `JWT_SECRET` | 32+ character string | JWT signing key |
| `REDIS_HOST` | `localhost` | Redis host for BullMQ |
| `REDIS_PORT` | `6379` | Redis port |
| `BASE_DOMAIN` | `dropdeploy.app` | Subdomain base for deployed apps |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker daemon socket |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Frontend URL |
| `PROJECTS_DIR` | `~/.dropdeploy/projects` | Cloned repo storage (default) |
| `DOCKER_DATA_DIR` | `~/.dropdeploy/docker` | Docker data storage (default) |

---

## 12. Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16 (App Router), React 18, Tailwind CSS, shadcn/ui |
| Backend | Next.js API Routes, Prisma ORM |
| Auth | bcryptjs, jose (JWT HS256) |
| Queue | BullMQ + Redis |
| Containers | dockerode, Nginx reverse proxy |
| Database | PostgreSQL |
| Git | simple-git |
| Validation | Zod, TypeScript strict mode |
