# Custom domains

Lets a project be served from a domain its owner controls (`myapp.com`) instead of
only its DropDeploy subdomain (`my-project.app.en3.wtf`), with an HTTPS
certificate issued and renewed automatically.

---

## How a request flows

```
Browser  https://myapp.com
   │
   ▼
Caddy (:443)                     TLS only. On a hostname it has no certificate
   │  on-demand TLS              for, it asks the app before ordering one.
   │  └─ ask → GET /api/internal/tls-check?domain=myapp.com  → 200 | 403
   ▼
Next.js app (:3001)              Host header arrives unmodified.
   │
   ├─ src/proxy.ts
   │     1. *.BASE_DOMAIN regex        → rewrite (unchanged, free)
   │     2. custom-domain lookup       → rewrite  ← new
   │     3. platform host              → auth guard
   │
   ▼
/api/proxy/{slug}/…              Unchanged: re-resolves the deployment,
   │                             applies the private-URL gate, records ProxyHit.
   ▼
127.0.0.1:{containerPort}
```

The custom-domain branch rewrites to exactly the same internal route as a
subdomain request. That is deliberate — a custom domain therefore inherits the
private-URL gate, the analytics and the header hygiene without any of it being
reimplemented, and cannot become a way around them.

### One authoritative router

`src/proxy.ts` is the only layer that maps a hostname to a project. The edge
terminates TLS and passes through with the original `Host` intact; it does not
route to container ports.

This used to be ambiguous: `NginxService` wrote a per-slug `server { … proxy_pass
127.0.0.1:{port}; }` block and was injected into `DeploymentService`. It turned
out to have **no call sites** — it was already dead — and it has been removed
along with `NGINX_CONFIG_PATH`. If you reintroduce an nginx path, it must
terminate TLS and proxy to `127.0.0.1:3001` only. An edge that proxies a
hostname straight to a container silently bypasses the privacy gate and the
`ProxyHit` analytics.

---

## Verification: two independent signals

| Signal | Record | Proves |
|---|---|---|
| Ownership | `TXT _dropdeploy-verify.myapp.com` = `dropdeploy-verify=<token>` | the user controls the domain |
| Routing | `A myapp.com` → `PLATFORM_INGRESS_IP`, or `CNAME` → `CUSTOM_DOMAIN_CNAME_TARGET` | traffic will actually reach us |

Ownership is what gates certificate issuance. Pointing a domain at our IP is
not proof of anything — anyone can do that for a domain they don't own — so
routing alone never unlocks a certificate.

```
PENDING_DNS ──TXT found──▶ VERIFIED ──A/CNAME found──▶ PROVISIONING ──HTTPS served──▶ ACTIVE
     ▲                         │                            │
     └──── TXT missing ────────┘                            └── CAA blocks LE ──▶ FAILED
```

`ACTIVE` is set when a real HTTPS request arrives for the host. The ask endpoint
fires *before* issuance, so a 200 there only means we permitted an order — it is
not evidence a certificate exists.

An `ACTIVE` domain that fails five consecutive re-checks is torn down. That is
the dangling-DNS defence: a hostname whose owner removed the record or let the
domain lapse stops being served before someone else can register it and inherit
a live tenant hostname. Five, not one, so a DNS blip doesn't take a site down.

The teardown needs both halves to work. Flipping the status is not enough on its
own — the edge holds a valid certificate for weeks and will keep completing the
handshake, because it consults the ask endpoint only to *obtain* a certificate,
never to serve one it already has. So `src/proxy.ts` also refuses to route any
host whose status is outside `ISSUABLE_STATUSES`. Routing and issuance are
deliberately gated on the same set: a host we would not issue for is a host we
must not serve.

---

## Setup

### 1. DNS for the platform

Keep the existing wildcard: `*.BASE_DOMAIN` → platform IP, wildcard certificate
over DNS-01 (the only challenge that can issue a wildcard). Then publish the two
targets users will point at:

- `PLATFORM_INGRESS_IP` — the ingress A record, for apex domains.
- `CUSTOM_DOMAIN_CNAME_TARGET` — e.g. `ingress.en3.wtf`, an A record pointing at
  the same IP. Prefer this for sub-domains: it lets you renumber the platform
  without every tenant editing their DNS.

### 2. Environment

```bash
CUSTOM_DOMAINS_ENABLED="true"
TLS_CHECK_ENABLED="true"
PLATFORM_INGRESS_IP="203.0.113.10"
CUSTOM_DOMAIN_CNAME_TARGET="ingress.en3.wtf"
INTERNAL_EDGE_TOKEN="$(openssl rand -hex 32)"
# Any other named host this app answers on, comma-separated. Sub-domains of
# each entry are covered. Omitting a host that receives traffic means it 404s.
PLATFORM_EXTRA_HOSTS="status.en3.wtf,internal-lb.example"
```

### 3. Edge

```bash
docker compose -f infra/caddy/docker-compose.caddy.yml up -d
```

`infra/caddy/Caddyfile` carries the annotated configuration. Two things that
matter more than they look:

- **Uncomment `acme_ca` (staging) for the first run.** Staging certificates are
  untrusted by browsers but its rate limits are far higher. Validate the whole
  flow there before spending production quota.
- **`caddy_data` must be a durable volume.** On a fresh volume Caddy re-orders
  every certificate it held, which is the fastest way to exhaust the Let's
  Encrypt weekly limit.

### 4. Background worker

Add a third app to `ecosystem.config.js` alongside `dropdeploy-app` and
`dropdeploy-worker` — see [deployment.md](deployment.md) for the full file:

```js
{
  name: 'dropdeploy-domains',
  script: 'node_modules/.bin/tsx',
  args: 'src/workers/domain.worker.ts',
  cwd: '/home/ubuntu/dropdeploy',
  instances: 1,
  exec_mode: 'fork',
  env_file: '/home/ubuntu/dropdeploy/.env',
  restart_delay: 5000,
  max_restarts: 10,
  log_file: '/home/ubuntu/logs/domains.log',
  error_file: '/home/ubuntu/logs/domains-error.log',
}
```

```bash
pm2 start /home/ubuntu/ecosystem.config.js --only dropdeploy-domains
pm2 save
```

`instances` must stay at 1: the sweep is a repeatable BullMQ job with a fixed job
id, so a second copy only duplicates the DNS fan-out. It is safe to start before
the feature is switched on — with `CUSTOM_DOMAINS_ENABLED=false` it logs a
warning and idles.

Sweeps non-terminal domains every 2 minutes with per-domain exponential backoff
(2 min → 1 h). Without it, a user who adds the DNS records and never returns to
press "Verify" stays on `PENDING_DNS` forever, and no `ACTIVE` domain is ever
re-checked.

For local development `npm run worker:domains` runs the same thing in the
foreground.

### 5. Quota

`User.domainQuota` (default `1`) caps domains across all of a user's projects.
Set per user via `PATCH /api/admin/users/:userId/quota` with `{"domainQuota": 5}`.

---

## Security notes

**The ask endpoint is a control, not a lookup.** If `/api/internal/tls-check`
ever returned `200` for arbitrary hosts, anyone could point a domain at the
ingress IP and make the platform order certificates for it — exhausting the
Let's Encrypt per-registered-domain quota for every real tenant, and opening a
domain-fronting path. It is deny-by-default at four levels: feature flag,
issuance flag, edge token, and a status only DNS-proven ownership reaches. An
unset `INTERNAL_EDGE_TOKEN` fails closed rather than degrading to open. Bind it
to loopback at the edge; the token is defence in depth, not the only control.

**`CustomDomain.hostname` is globally unique.** That index is the claim lock: two
projects can never hold one hostname, which is the takeover vector.

**Unknown hosts get a 404, not the dashboard.** Serving the login page from a
domain an attacker controls would be a phishing primitive. `BASE_DOMAIN`,
`APP_URL`'s host, `localhost` and IP literals are exempt so LAN dev and health
checks still work. Any *other* named host the platform answers on — a monitoring
alias, a staging CNAME, a health check that connects by name — must be listed in
`PLATFORM_EXTRA_HOSTS`, or it will 404 once the feature is on.

**Rate limits.** Add/update 20/min/user; manual verify 6/min/user (each call
fans out to several outbound DNS queries against a user-chosen hostname); the
ask endpoint 5/min/hostname, matching Caddy's own burst.

---

## Rollback

Set `CUSTOM_DOMAINS_ENABLED=false` and restart. The proxy stops resolving custom
hosts, the API refuses mutations, and the ask endpoint denies every order.
`*.BASE_DOMAIN` routing is untouched by any of this, so **rollback cannot break an
existing deployment.** The migration is additive (one table, one enum, one
defaulted column) and is safe to leave in place.

To stop only new certificates while keeping live domains serving, set
`TLS_CHECK_ENABLED=false` instead.

---

## Known limits

- **Wildcard custom domains** (`*.customer.com`) are out of scope — they need
  DNS-01 and therefore the customer's DNS API credentials.
- **Multi-node.** The `host → slug` cache is per-instance with a 60s TTL, so a
  domain change can take up to a minute to be seen by an instance that did not
  handle the write. Certificate storage must be shared before scaling the edge
  horizontally, or instances will re-issue against each other.
- **Apex CNAME.** Some registrars cannot `CNAME` an apex. The UI offers the
  A record and mentions ALIAS/ANAME; `www` plus a redirect is the usual advice.
- **Apex detection** for DNS *advice* uses a small two-label-suffix list rather
  than the full public suffix list. A miss there produces slightly wrong copy,
  never a wrong authorisation decision.
