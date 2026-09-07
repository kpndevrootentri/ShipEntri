# nginx → Caddy cutover

Moving the edge from nginx to Caddy, so that custom domains can get certificates.
Everything here is grounded in the live state of the production host as surveyed
on 2026-09-05.

Read this once end to end before starting. The cutover itself is about five
minutes; the preparation is what makes it safe.

---

## Why this is needed

Custom domains need a certificate per hostname, issued at the moment an unknown
host first connects. nginx has no equivalent of Caddy's on-demand TLS. Until the
edge moves, `CUSTOM_DOMAINS_ENABLED` cannot usefully be turned on: a tenant would
point DNS at us and get a failed TLS handshake.

---

## What is running today

| | |
|---|---|
| Edge | nginx 1.24.0, binding `:80` and `:443` |
| Sites | `dropdeploy-app` (`app.en3.wtf`), `dropdeploy-projects` (`*.app.en3.wtf`) |
| Upstream | both `proxy_pass http://127.0.0.1:3000` |
| App | `next-server` on `*:3000` under PM2 |
| DNS | Route 53, with a wildcard `*.en3.wtf` A record → `3.109.99.141` |
| Docker | 29.2.1, Compose v5.1.0 |

### Certificates

| Name | Covers | Renewal | Expires |
|---|---|---|---|
| `app.en3.wtf` | `*.app.en3.wtf` **and** `app.en3.wtf` | `authenticator = manual` ⚠️ | 2026-12-03 |
| `app.en3.wtf-0001` | `app.en3.wtf` only | `authenticator = nginx` (auto) | 2026-12-02 |
| `en3.wtf` | `*.en3.wtf`, `en3.wtf` | manual | **expired 2026-08-06** |

Two things follow from this table, and they matter more than the cutover itself.

> [!warning] The wildcard cannot renew itself
> `app.en3.wtf` is `authenticator = manual` — it was issued by hand over DNS-01,
> and `certbot renew` cannot reissue it unattended. It expires **2026-12-03**.
> Nothing on the box will stop that happening. This is true today, with nginx,
> and the cutover neither causes nor fixes it. §7 is what fixes it.

The `-0001` certificate is redundant: the wildcard already covers `app.en3.wtf`
as a SAN. It exists because certbot was run twice with different challenge types.
Caddy will serve everything from the wildcard, and `-0001` can be retired.

---

## Design decisions

**Caddy reuses the existing certbot wildcard rather than issuing its own.**
The Caddyfile points `tls` at `/etc/letsencrypt/live/app.en3.wtf/`. This is the
single most important choice in the plan: the cutover then places **zero ACME
orders**, so it cannot fail because an order was rejected, rate-limited, or slow.
The platform's own hostname is never at the mercy of Let's Encrypt during a
change window. Custom domains still get on-demand issuance, because they use
HTTP-01/TLS-ALPN, which needs no DNS credentials.

**nginx stays installed, configured, and stopped.** It is the rollback. Not
uninstalled, not deleted — one `systemctl start nginx` away for as long as you
want the safety net.

**Validate on alternate ports first.** Caddy runs on `:8080`/`:8443` and is
exercised with `curl --resolve` before it is ever given the real ports. Two
services cannot bind `:443`, so the swap is the only moment of exposure, and by
then everything else is known-good.

---

## 1. Pre-flight

```bash
# The app must be healthy before you change anything in front of it.
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login    # 200
pm2 status                                                                # all online

# Back up the nginx config and note the exact cert paths.
sudo tar czf ~/backups/nginx-$(date +%Y%m%d-%H%M%S).tar.gz /etc/nginx
sudo certbot certificates | grep -E "Certificate Name|Domains|Expiry"

# Database backup — the app is not changing, but take one anyway.
pg_dump "$DATABASE_URL" -Fc -f ~/backups/dropdeploy-precutover-$(date +%Y%m%d-%H%M%S).dump
```

Confirm the wildcard cert is readable and covers what you expect:

```bash
sudo openssl x509 -in /etc/letsencrypt/live/app.en3.wtf/fullchain.pem -noout -dates \
  -ext subjectAltName
# Expect: DNS:*.app.en3.wtf, DNS:app.en3.wtf   and notAfter=Dec  3 ...
```

---

## 2. Configure

Create `/home/ubuntu/caddy/.env` (Compose reads it automatically):

```bash
BASE_DOMAIN=app.en3.wtf
APP_UPSTREAM=127.0.0.1:3000
INTERNAL_EDGE_TOKEN=<same value as in ShipEntri/.env>
ACME_EMAIL=you@example.com
WILDCARD_CERT=/etc/letsencrypt/live/app.en3.wtf/fullchain.pem
WILDCARD_KEY=/etc/letsencrypt/live/app.en3.wtf/privkey.pem
```

`INTERNAL_EDGE_TOKEN` must match the app's exactly — it is what authorises the
ask endpoint. A mismatch means every custom-domain handshake fails with a 403
that looks, from outside, like the feature simply not working.

Copy `infra/caddy/Caddyfile` and `infra/caddy/docker-compose.caddy.yml` next to
that `.env`.

---

## 3. Rehearse on alternate ports

Temporarily change the two site addresses in the Caddyfile from `:443` to
`:8443` and `:80` to `:8080`, then:

```bash
docker compose -f docker-compose.caddy.yml up -d
docker compose -f docker-compose.caddy.yml logs --tail 50
```

Exercise it without touching DNS or the live ports:

```bash
# Platform host, through Caddy, using the real SNI
curl -sS -k --resolve app.en3.wtf:8443:127.0.0.1 https://app.en3.wtf:8443/login \
  -o /dev/null -w "app: %{http_code}\n"

# An existing tenant subdomain — substitute a real deployed slug
curl -sS -k --resolve <slug>.app.en3.wtf:8443:127.0.0.1 \
  https://<slug>.app.en3.wtf:8443/ -o /dev/null -w "tenant: %{http_code}\n"

# The certificate Caddy is actually serving should be certbot's, not a new one
echo | openssl s_client -connect 127.0.0.1:8443 -servername app.en3.wtf 2>/dev/null \
  | openssl x509 -noout -issuer -dates -ext subjectAltName
```

Both should return `200`, and the certificate dates must match the certbot one
from §1. If they differ, Caddy issued its own — stop and fix the `tls` line
before going further.

Then put the ports back to `:443`/`:80` and `docker compose down`.

---

## 4. The swap

The only moment of downtime — a few seconds.

```bash
sudo systemctl stop nginx
docker compose -f docker-compose.caddy.yml up -d
sleep 5
sudo ss -tlnp | grep -E ':80 |:443 '     # should now show docker/caddy
```

Verify from **outside** the box, not just locally:

```bash
for u in https://app.en3.wtf/login https://app.en3.wtf/explore; do
  curl -sS -o /dev/null -w "$u -> %{http_code}\n" "$u"
done
curl -sS -o /dev/null -w "tenant -> %{http_code}\n" https://<slug>.app.en3.wtf/
curl -sSI http://app.en3.wtf/ | head -3          # expect 308/301 → https
```

Also confirm the things a plain page load will not exercise:

- **Log streaming** — open a project's deployment logs in the dashboard. SSE
  through a misconfigured proxy fails silently or arrives in bursts;
  `flush_interval -1` in the Caddyfile is what prevents that.
- **A file upload** — nginx was running on defaults, which means
  `client_max_body_size 1m`. Caddy imposes no body limit, so uploads that used
  to fail at 1 MB will now succeed. That is a fix, but it is a behaviour change:
  the platform will start accepting larger uploads than it did yesterday.
- **A deployment**, end to end.

### Rollback

```bash
docker compose -f docker-compose.caddy.yml down
sudo systemctl start nginx
```

Under five seconds, and nothing about the app or database has changed.

---

## 5. Settle

Only once you are confident, and not in the same window:

```bash
# Stop nginx claiming :443 after a reboot — but keep it installed as rollback.
sudo systemctl disable nginx
```

> [!danger] certbot's automatic renewal breaks here
> `certbot.timer` renews `app.en3.wtf-0001` with the **nginx** authenticator,
> which needs a running nginx. Once nginx is stopped, that renewal fails every
> time. The certificate is redundant (the wildcard covers the same name), so the
> fix is to remove it rather than repair it:
> ```bash
> sudo certbot delete --cert-name app.en3.wtf-0001
> ```
> Do not disable `certbot.timer` wholesale — §7 may put a renewable certificate
> back under certbot's care, and a disabled timer is easy to forget.

Clean up the expired `en3.wtf` certificate too, if nothing uses it:

```bash
sudo certbot certificates                 # confirm nothing references it
sudo certbot delete --cert-name en3.wtf
```

---

## 6. Enable custom domains

Only now do the flags go on — the edge exists, so the feature can actually work.

```bash
# In ShipEntri/.env — fix the CNAME target first. "*.app.en3.wtf" is not a
# usable CNAME target; a wildcard cannot be the right-hand side of a CNAME.
CUSTOM_DOMAIN_CNAME_TARGET="ingress.en3.wtf"
CUSTOM_DOMAINS_ENABLED="true"
TLS_CHECK_ENABLED="true"
```

`ingress.en3.wtf` already resolves to `3.109.99.141` via the `*.en3.wtf`
wildcard, but create it as an **explicit** A record in Route 53 anyway. Relying
on the wildcard means the target silently breaks the day someone narrows that
record, and it is the one hostname every tenant's DNS will depend on.

```bash
pm2 restart dropdeploy-app dropdeploy-domains
```

Then dogfood one real domain end to end, and confirm the negative case: point an
*unverified* hostname at the ingress and check the handshake fails while
`/api/internal/tls-check` logs `not-verified`.

> [!note] The `*.en3.wtf` wildcard A record has a side effect
> Every conceivable `*.en3.wtf` name resolves to this box, so bots and scanners
> will reach Caddy with hostnames that are not custom domains. Each one triggers
> an ask lookup. That is expected and bounded — the resolver negative-caches
> unknown hosts and the ask endpoint is rate-limited to 5/min per hostname — but
> it means `not-verified` denials in the log are normal background noise, not
> necessarily an attack.

---

## 7. The part that actually matters: wildcard renewal

**Deadline: 2026-12-03.** After the cutover the wildcard is still certbot's and
still `authenticator = manual`. If nothing changes, `*.app.en3.wtf` — every
tenant subdomain and the dashboard itself — goes dark that day.

Since DNS is Route 53 and the host is already on AWS, the fix is to let Caddy own
the wildcard over DNS-01:

1. **Build a Caddy image with the Route 53 plugin.** The stock image cannot do
   DNS-01: `xcaddy build --with github.com/caddy-dns/route53`.
2. **Grant credentials.** An IAM role on the instance is better than static keys.
   It needs only `route53:ListHostedZonesByName`, `route53:GetChange` and
   `route53:ChangeResourceRecordSets` scoped to the `en3.wtf` hosted zone.
3. **Swap the `tls` block** for the commented DNS-01 variant in the Caddyfile.
4. **Test against Let's Encrypt staging first** (`acme_ca` line in the Caddyfile).
   A wildcard order that fails against production burns quota; against staging
   it costs nothing.
5. Once Caddy holds a wildcard of its own, retire the certbot one.

Do this well before December, not in the last week — a failed wildcard order
with three days left is a genuinely bad position.

---

## Executed 2026-09-05

Steps 1–4 were run on the production host. Rehearsal caught three config faults
before any of them could touch live traffic — the reason §3 exists:

| Fault | Symptom | Fix |
|---|---|---|
| `email` wired to an unset variable | `email` with no argument is a **parse error**, Caddy would not start | commented out; set it before Step 6 |
| `on_demand_tls { interval / burst }` | removed in Caddy 2.10 (host runs 2.11.4); config rejected | removed — see below |
| Caddy auto-binds `:80` | collided with nginx during rehearsal | `http_port`/`https_port` overrides, rehearsal only |

> [!warning] The edge no longer rate-limits certificate issuance
> Dropping `interval`/`burst` was forced, not chosen. Caddy 2.10 removed them.
> The ask endpoint's own limiter (`checkTlsAskRateLimit`, 5/min per hostname) is
> now the **only** throttle between a hostname scan and the Let's Encrypt quota
> of 50 certificates per registered domain per week. Treat it as load-bearing.

Post-swap verification, from outside the host: `app.en3.wtf` `/`, `/login`,
`/explore` all 200; tenant subdomain 200; HTTP→HTTPS 301; certificate served is
certbot's wildcard (`notAfter=Dec 3`), confirming Caddy placed no ACME order.
Security headers present, gzip negotiated, no application errors.

One hardening change was made during the cutover: `/api/internal/*` is now
refused at the edge. Caddy reaches the ask endpoint directly on the upstream
address, which does not pass through the public site block, so this removes the
endpoint from the internet at no cost. Its token check still stands behind it.

## Summary of risk

| Risk | Likelihood | Mitigation |
|---|---|---|
| Caddy misroutes or breaks a tenant | Low | §3 rehearsal on alternate ports before the swap |
| Downtime during swap | Certain, seconds | Single stop/start; rollback in one command |
| Cutover fails because of ACME | **Removed** | Reuses the existing cert; places no orders |
| certbot renewal fails afterwards | Certain if ignored | §5 — delete the redundant `-0001` |
| Wildcard expires 2026-12-03 | **High if ignored** | §7 — the real work, on a deadline |
| Larger uploads now accepted | Certain | Behaviour change; set a body limit if unwanted |
