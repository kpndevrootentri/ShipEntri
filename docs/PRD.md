# Product Requirements Document (PRD)

## Product Name
**DropDeploy** (working name)

---

## 1. Objective

Build a web platform that allows users to **deploy projects instantly** by:
- Drag & dropping a project directory
- OR providing a GitHub repository URL

The system automatically builds, deploys, and hosts the project, returning a **publicly accessible URL**.

---

## 2. Goals & Non-Goals

### Goals (MVP)
- GitHub repo deployment
- Automatic project type detection
- Containerized build and runtime
- Live deployment URL
- Build status tracking with step-by-step progress
- Configurable deploy branch per project
- Interactive terminal for deployed containers
- Local network access URLs
- Secure execution environment

### Non-Goals (Out of Scope for MVP)
- Custom domains
- Billing & subscriptions
- Autoscaling
- Secrets management UI
- Multi-region hosting

---

## 3. Target Users

- Frontend developers
- Students & learners
- Hackathon participants
- Internal demo / QA teams

---

## 4. User Stories

### US-1: Deploy GitHub Repo
As a user, I want to paste a GitHub repository URL and deploy it automatically.

### US-2: Track Deployment
As a user, I want to see build progress with step-by-step indicators (cloning, building, starting) in real time.

### US-3: Access Deployed App
As a user, I want a stable URL to access my deployed project, plus a local network URL for testing on other devices.

### US-4: Choose Deploy Branch
As a user, I want to select which git branch to deploy, and switch branches on subsequent deploys.

### US-5: Container Terminal
As a user, I want to run commands inside my deployed container to debug issues, view logs, and inspect the environment.

---

## 5. Functional Requirements

### 5.1 Authentication
- Email & password authentication (MVP)
- JWT-based sessions stored in httpOnly cookies
- Session validation endpoint
- Logout endpoint
- One user can manage multiple projects

---

### 5.2 Project Creation

#### Upload Mode
- Drag & drop folder upload (client-side zip)
- Max upload size: **100MB**
- Basic structure validation

#### GitHub Mode
- Public repositories only
- Clone via HTTPS
- Validate repository availability
- Configurable deploy branch (default: `main`)

---

### 5.3 Project Type Detection

Project type is detected based on file presence:

| File | Project Type |
|----|---|
| `index.html` | Static Site |
| `package.json` | Node.js |
| `next.config.js` | Next.js |
| `requirements.txt` + `manage.py` | Django |

---

### 5.4 Build & Deployment

- Each deployment runs in an **isolated Docker container**
- Dockerfile generated dynamically based on project type
- Build image → run container
- Assign random available port (8000--9999)
- Map project to subdomain
- Repos persist locally for faster subsequent deployments (clone-once strategy)
- Branch switching supported between deploys

---

### 5.5 Deployment Status

Supported statuses:
- `QUEUED`
- `BUILDING`
- `DEPLOYED`
- `FAILED`

Build step tracking:
- `CLONING` -- Cloning or updating the repository
- `BUILDING_IMAGE` -- Building the Docker image
- `STARTING` -- Starting the container

Timing:
- `startedAt` -- When the build worker begins processing
- `completedAt` -- When the deployment succeeds or fails

Logs:
- Capture build & error logs
- Persist logs in the deployment record

---

### 5.6 URL Management

- Auto-generated subdomain per project: `https://{project-slug}.dropdeploy.app`
- Nginx routes subdomain traffic to the correct container port
- Local network URL displayed for same-network device access: `http://<local-ip>:<port>`

---

### 5.7 Branch Management

- Each project stores a configurable `branch` field (default: `main`)
- Branch can be changed in project settings
- Redeploying after a branch change checks out the new branch
- Git service handles shallow/unshallow conversion for branch discovery

---

### 5.8 Interactive Terminal

- Execute shell commands inside deployed containers
- Built-in slash commands for common operations (`/show-logs`, `/tail-logs`, `/env`, `/files`, `/help`)
- Command allowlist for safety (ls, cat, pwd, echo, env, npm, node, python, curl, etc.)
- 30-second timeout per command
- Terminal UI with command history, autocomplete, and resizable output

---

## 6. Non-Functional Requirements

### Performance
- Deployment start time < 10 seconds
- Static site deployment < 30 seconds
- Subsequent deploys faster due to persistent repo clones

### Security
- Docker sandboxing
- Non-root containers
- CPU & memory limits
- Terminal command allowlist
- No host filesystem access (containers use configurable data directories)

### Reliability
- Build failures must not impact other deployments
- Retry-safe deployment jobs
- Graceful degradation when Redis is unavailable

---

## 7. Tech Stack

### Frontend
- Next.js 16 (App Router)
- React
- Tailwind CSS + shadcn/ui
- React Dropzone

### Backend
- Next.js API Routes
- Prisma ORM
- PostgreSQL
- Redis + BullMQ (job queue)

### Infrastructure
- Docker (dockerode)
- Nginx (Reverse Proxy)
- simple-git
- Single VPS (MVP)
