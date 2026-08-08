# Monitoring Setup — DropDeploy (Linux)

Target: Linux server, 2 vCPU / 4 GB RAM / 50 GB storage  
All commands run on the Linux server unless noted otherwise.

## Prerequisites

```bash
# Install Docker if not already present
curl -fsSL https://get.docker.com | sh

# Install Docker Compose plugin
apt-get install -y docker-compose-plugin

# Install Nginx and htpasswd utility
apt-get install -y nginx apache2-utils

# Install Certbot for SSL
apt-get install -y certbot python3-certbot-nginx
```

---

## Phase 0 — Netdata (~128 MB RAM)

### 1. Copy monitoring directory to the server

From your local machine:
```bash
rsync -av monitoring/ user@yourserver:/opt/dropdeploy/monitoring/
```

Or if DropDeploy is already cloned on the server:
```bash
cd /path/to/dropdeploy
```

### 2. Configure Slack alerts

```bash
# Copy the example template — the real file is gitignored (contains live webhook URL)
cp infra/monitoring/netdata/health_alarm_notify.conf.example \
   infra/monitoring/netdata/health_alarm_notify.conf

# Edit and replace the placeholder webhook URL with your real one
nano infra/monitoring/netdata/health_alarm_notify.conf
```

### 3. Start Netdata

```bash
docker compose -f monitoring/docker-compose.yml up -d netdata
```

Verify it's running (dashboard on localhost, not yet public):
```bash
curl -s http://localhost:19999/api/v1/info | grep -o '"version":"[^"]*"'
```

### 4. Set up Nginx reverse proxy

```bash
# Copy vhost config
cp monitoring/nginx/monitoring.conf /etc/nginx/sites-enabled/monitoring.conf

# Edit and replace YOUR_BASE_DOMAIN with your actual domain (e.g. en3.wtf)
nano /etc/nginx/sites-enabled/monitoring.conf

# Create basic auth credentials (you'll be prompted for a password)
htpasswd -c /etc/nginx/.htpasswd admin

# Get SSL certificate (replace with your domain)
certbot --nginx -d monitor.YOUR_BASE_DOMAIN

# Reload Nginx
nginx -t && nginx -s reload
```

### 5. Verify

```bash
# Dashboard should be accessible at:
# https://monitor.YOUR_BASE_DOMAIN/netdata/

# Test Slack alert notification
docker exec netdata /usr/libexec/netdata/plugins.d/alarm-notify.sh test
```

What Netdata auto-discovers (no config needed):
- Docker containers — CPU, memory, network per container
- Redis — connections, commands/sec, memory, hit rate
- PostgreSQL — connections, queries, locks, table bloat
- Nginx — active connections, request rate, 4xx/5xx errors
- Host — CPU, RAM, disk I/O, network — at 1-second granularity

---

## Phase 1 — Prometheus + Grafana (~+300 MB RAM)

Check available RAM before proceeding:
```bash
free -h
# Need at least 300 MB free
```

### 1. Set required environment variables

Grafana and node-exporter are now enabled alongside Prometheus (all P1 components
are uncommented by default). Before starting, export the required variables:

```bash
export BASE_DOMAIN=en3.wtf
export GRAFANA_ADMIN_PASSWORD=<choose-a-strong-password>
```

Or add them to `/opt/dropdeploy/.env` (Docker Compose will pick them up automatically).

### 2. Add prom-client to DropDeploy

```bash
npm install prom-client
```

Create `src/lib/metrics.ts`:
```typescript
import { Registry, Counter, Gauge, Histogram } from 'prom-client'

export const register = new Registry()

export const deploymentTotal = new Counter({
  name: 'dropdeploy_deployments_total',
  help: 'Total deployments',
  labelNames: ['status', 'project_type'] as const,
  registers: [register],
})
export const queueDepth = new Gauge({
  name: 'dropdeploy_queue_depth',
  help: 'QUEUED deployments waiting',
  registers: [register],
})
export const buildDuration = new Histogram({
  name: 'dropdeploy_build_duration_seconds',
  help: 'Build duration in seconds',
  labelNames: ['project_type'] as const,
  buckets: [30, 60, 120, 300, 600],
  registers: [register],
})
export const workerAlive = new Gauge({
  name: 'dropdeploy_worker_alive',
  help: '1 if worker heartbeat is fresh, 0 if dead',
  registers: [register],
})
```

Create `src/app/api/metrics/route.ts`:
```typescript
import { register } from '@/lib/metrics'
import { NextResponse } from 'next/server'

// Internal endpoint — Prometheus scrapes this every 15s
// Do NOT expose publicly; Nginx should block /api/metrics from external traffic
export async function GET() {
  return new NextResponse(await register.metrics(), {
    headers: { 'Content-Type': register.contentType },
  })
}
```

### 3. Start P1 stack

```bash
docker compose -f monitoring/docker-compose.yml up -d prometheus grafana node-exporter
```

Verify all three targets are UP before proceeding:
```bash
# Should show dropdeploy_api and node jobs both as UP
curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health}'
```

### 4. Access Grafana

Grafana runs on `127.0.0.1:3100` (localhost only). Access via SSH tunnel from your local machine:
```bash
ssh -L 3100:localhost:3100 user@yourserver
# Then open http://localhost:3100 in your browser
```

Import dashboards (Grafana → Dashboards → Import):
- ID `1860` — Node Exporter Full (host CPU/RAM/disk/network)
- ID `893` — Docker container metrics

### 5. Deploy the main app Nginx vhost (required — blocks /api/metrics)

`infra/nginx/app.conf.example` ships a complete main vhost that enforces the
`/api/metrics` deny rule. Deploy it instead of adding a manual block:

```bash
cp infra/nginx/app.conf.example /etc/nginx/sites-enabled/dropdeploy.conf
sed -i 's/YOUR_BASE_DOMAIN/en3.wtf/g; s/YOUR_APP_PORT/3001/g' \
    /etc/nginx/sites-enabled/dropdeploy.conf
certbot --nginx -d app.en3.wtf
nginx -t && nginx -s reload
```

If you already have a custom vhost, add this block inside your `server { }`:
```nginx
location = /api/metrics {
    deny all;
    return 403;
}
```

---

## Phase 2 — Loki + Promtail (~+200 MB RAM)

Check available RAM before proceeding:
```bash
free -h
# Need at least 200 MB free
```

### 1. Uncomment services in docker-compose.yml

In `monitoring/docker-compose.yml`, uncomment:
- `loki` service block
- `promtail` service block
- The `loki_data` volume entry

### 2. Start P2 stack

```bash
docker compose -f monitoring/docker-compose.yml up -d loki promtail
```

### 3. Add Loki to Grafana

Uncomment the Loki block in `monitoring/grafana/provisioning/datasources/datasources.yml`:
```yaml
- name: Loki
  type: loki
  access: proxy
  url: http://loki:3100
```

Then restart Grafana:
```bash
docker compose -f monitoring/docker-compose.yml restart grafana
```

---

## Useful Commands

```bash
# Check RAM usage per container
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}"

# Tail monitoring logs
docker compose -f monitoring/docker-compose.yml logs -f

# Restart a specific service
docker compose -f monitoring/docker-compose.yml restart netdata

# Stop everything (volumes preserved)
docker compose -f monitoring/docker-compose.yml down

# Stop and delete all data volumes (destructive)
docker compose -f monitoring/docker-compose.yml down -v
```
