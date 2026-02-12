# DropDeploy – Architecture & Folder Structure

This document describes the scalable folder structure and architecture aligned with the [PRD](./PRD.md) and project rules.

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Presentation Layer                            │
│  Next.js App Router │ React Components (ui / features / layouts)  │
└─────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────┐
│                     Application Layer                            │
│  API Routes │ Auth / Project / Deployment / Terminal Services     │
└─────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────┐
│                     Domain Layer                                  │
│  Types │ Validators (Zod) │ Value Objects                         │
└─────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────┐
│                     Infrastructure Layer                          │
│  Repositories (Prisma) │ Queue (BullMQ) │ Docker │ Git │ Nginx    │
└─────────────────────────────────────────────────────────────────┘
```

- **Presentation**: App Router routes, React components, and custom hooks; no business logic.
- **Application**: API handlers and services (auth, project, deployment, docker, git, terminal).
- **Domain**: Shared types, DTOs, and validation schemas.
- **Infrastructure**: Data access (repositories), queue, Docker, Git, Nginx configs.

---

## 2. Folder Structure

```
dropDeploy/
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── (auth)/                 # Auth route group (login, register)
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   └── layout.tsx
│   │   ├── (dashboard)/            # Protected dashboard routes
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── projects/[id]/page.tsx  # Project detail (overview/settings/advanced)
│   │   │   └── layout.tsx
│   │   ├── api/                    # API routes
│   │   │   ├── auth/
│   │   │   │   ├── login/route.ts
│   │   │   │   ├── logout/route.ts
│   │   │   │   ├── register/route.ts
│   │   │   │   └── session/route.ts
│   │   │   ├── projects/
│   │   │   │   ├── route.ts              # List / create projects
│   │   │   │   └── [id]/
│   │   │   │       ├── route.ts          # Get / update / delete project
│   │   │   │       ├── deploy/route.ts   # Trigger deployment
│   │   │   │       └── terminal/route.ts # Execute container commands
│   │   │   └── health/route.ts
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── ui/                     # Reusable UI (Button, Card, etc.)
│   │   ├── features/               # Feature-specific components
│   │   │   ├── auth-header.tsx
│   │   │   ├── create-project-form.tsx
│   │   │   ├── dashboard-nav.tsx
│   │   │   ├── project-list.tsx
│   │   │   ├── project-tile.tsx
│   │   │   └── terminal.tsx        # Interactive container terminal
│   │   └── layouts/                # Layout components
│   ├── hooks/                      # Custom React hooks
│   │   ├── use-fetch-mutation.ts
│   │   ├── use-terminal.ts         # Terminal command execution & history
│   │   └── index.ts
│   ├── lib/                        # Shared utilities & infra clients
│   │   ├── api-error.ts
│   │   ├── auth-cookie.ts
│   │   ├── config.ts               # Zod-validated env (incl. PROJECTS_DIR, DOCKER_DATA_DIR)
│   │   ├── errors.ts
│   │   ├── get-session.ts
│   │   ├── local-ip.ts             # Local network IP detection
│   │   ├── prisma.ts
│   │   ├── queue.ts
│   │   ├── redis.ts
│   │   └── utils.ts
│   ├── repositories/               # Data access (repository pattern)
│   │   ├── user.repository.ts
│   │   ├── project.repository.ts
│   │   ├── deployment.repository.ts
│   │   └── index.ts
│   ├── services/                   # Business logic
│   │   ├── auth/
│   │   ├── project/
│   │   ├── deployment/
│   │   ├── docker/
│   │   │   ├── docker.service.ts
│   │   │   ├── docker-terminal.service.ts  # Container command execution
│   │   │   ├── dockerfile.templates.ts
│   │   │   ├── nextjs-config-patcher.ts
│   │   │   └── index.ts
│   │   └── git/
│   │       ├── git.service.ts      # Clone-once, branch switching
│   │       └── index.ts
│   ├── types/                      # TypeScript types & DTOs
│   │   ├── api.types.ts
│   │   ├── deployment.types.ts
│   │   ├── project.types.ts
│   │   └── index.ts
│   ├── validators/                 # Zod schemas
│   │   ├── auth.validator.ts
│   │   ├── project.validator.ts
│   │   └── index.ts
│   └── workers/                    # Background jobs (BullMQ)
│       └── deployment.worker.ts
├── prisma/
│   └── schema.prisma
├── docker/
│   ├── templates/                  # Dockerfile templates (per project type)
│   └── nginx/                      # Nginx reverse-proxy configs
├── scripts/
│   └── setup-dev.sh
└── docs/
    ├── PRD.md
    ├── ARCHITECTURE.md
    └── HOW-IT-WORKS.md
```

---

## 3. Key Conventions

| Concern            | Location / Pattern |
|--------------------|--------------------|
| HTTP & validation  | API routes parse body, call validators, then services |
| Errors             | `lib/errors.ts` + `lib/api-error.ts` for consistent responses |
| DB access          | Only via repositories; no Prisma in API routes or UI |
| Queue              | `lib/queue.ts` + `IDeploymentQueue`; worker in `workers/` |
| Auth               | JWT in `AuthService`; middleware verifies tokens; `lib/get-session.ts` extracts userId |
| Auth cookies       | `lib/auth-cookie.ts` manages httpOnly `auth-token` cookie |
| Project types      | PRD §5.3: STATIC, NODEJS, NEXTJS, DJANGO (templates in `services/docker/`) |
| Config             | Centralized Zod-validated env in `lib/config.ts` via `getConfig()` |
| DI pattern         | Services use constructor DI; export both the class and a singleton instance |
| Repo interfaces    | Repositories define interfaces (e.g. `IUserRepository`) in the same file |

---

## 4. Data Flow Examples

### Auth (register)

1. `POST /api/auth/register` → parse body → `registerSchema.parse()` → `authService.register()` → `userRepository.create()` → issue JWT → set `auth-token` cookie → return tokens.

### Deploy

1. `POST /api/projects/:id/deploy` → verify JWT → `deploymentService.createDeployment()` → `deploymentRepository.create()` + `deploymentQueue.add()`.
2. Worker: `deployment.worker.ts` processes job → `deploymentService.buildAndDeploy()` → `gitService.ensureRepo()` (clone or pull at configured branch) → `dockerService.buildImage()` → `dockerService.runContainer()` → update deployment status to `DEPLOYED`.

### Terminal command

1. `POST /api/projects/:id/terminal` → verify JWT → `dockerTerminalService.executeCommand()` or `executeSlashCommand()` → Docker exec in container → return `{ stdout, stderr, exitCode }`.

---

## 5. Scaling Notes

- **New features**: Add under `services/<feature>/`, `repositories/` if new entities, `app/api/` and `app/(dashboard)/` as needed.
- **New UI**: `components/features/<feature>/` and compose from `components/ui/`.
- **New hooks**: `hooks/use-<feature>.ts` for React-side logic.
- **New workers**: Add under `workers/` and a corresponding queue in `lib/queue.ts` if needed.
- **Config**: Centralize in `lib/config.ts`; keep env validation with Zod.

---

## 6. PRD Mapping

| PRD Section   | Implementation |
|---------------|----------------|
| §5.1 Auth     | `AuthService`, JWT, `userRepository`, `/api/auth/*` (login, logout, register, session) |
| §5.2 Projects | `ProjectService`, `ProjectRepository`, GitHub clone via `GitService` |
| §5.3 Type     | `ProjectType` enum, `DOCKERFILE_TEMPLATES` in `services/docker/` |
| §5.4 Build    | `DeploymentService`, `DockerService`, `GitService`, `deployment.worker.ts` |
| §5.5 Status   | `DeploymentStatus`, `deploymentRepository`, `buildStep` tracking (CLONING → BUILDING_IMAGE → STARTING) |
| §5.6 URL      | Subdomain + Nginx: `docker/nginx/example.conf`, `BASE_DOMAIN` in config |
| §5.7 Branch   | `project.branch` field, `GitService.ensureRepo()` with branch switching |
| §5.8 Terminal  | `DockerTerminalService`, `/api/projects/:id/terminal`, slash commands |
