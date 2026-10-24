# Grug Coach proxy (Cloudflare Worker)

A small proxy that lets the Lunk app talk to xAI without shipping an API key to the browser.

- `POST /chat` forwards `{ messages, model?, stream? }` to `UPSTREAM_URL` (default `https://api.x.ai/v1/chat/completions`). All other fields are dropped, `max_tokens` is forced to `MAX_TOKENS`, and the model must be in `ALLOWED_MODELS` (it defaults to `MODEL`). SSE streams are passed straight through.
- `GET /status` returns `{ enabled, owner, remaining, cap, used, resetAt, model, estimate: { remaining, cap, used, network } }` for the calling device.
- `POST /estimate` (v1.10.0, Smart Estimate on the Food tab) takes `{ text, portion?, image? }` (`image` = a JPEG/PNG/WebP data URL up to `EST_MAX_IMAGE_CHARS`, 1.5 M chars). The prompt is built here (`EST_PROMPT`), so `/estimate` can't be used as free chat. It's sent to `MODEL` non-streaming with `reasoning_effort: EST_REASONING` (`low`: a photo takes about 5–15 s instead of 45–60 s), timeout `EST_TIMEOUT_MS` (90 s). The reply is checked as strict JSON (`parseEstimate`) and returned as `{ items: [{ name, qty, grams, kcal, protein, carbs, fat, fibre }], confidence: low|med|high, note, remaining, cap, resetAt, owner }`. Photos and descriptions are never stored.
- Smart Estimate daily cap (separate from coach messages; an estimate never uses a coach message): `EST_DAILY_CAP` (3 since v1.10.1) successful estimates per device (`est:<day>:<device>`) and `EST_DAILY_CAP × EST_NETWORK_MULT` (9) per hashed network (`esti:<day>:<ipkey>`), on the same UTC day as the coach caps. Clearing data or using incognito gets a new device ID but not a new network. Only successful estimates count: upstream errors, timeouts (504), unreadable JSON (`bad_estimate`) and "not food" (422 `no_food`) don't use it up. The owner token bypasses it. Raise `EST_DAILY_CAP` in `wrangler.toml` (and the `EST_DAILY_CAP` mirror in `../src/estimate.ts`) when a paid tier exists. Two estimates sent at the same moment can both get through (the counter goes up after success, and KV is eventually consistent).
- Every request needs an allowed `Origin` (`ALLOWED_ORIGINS`) and an `X-Device-Id` UUID. With `X-Owner-Token: <OWNER_TOKEN>`, the daily caps don't apply.
- Daily caps are counted in Workers KV per UTC day: `DEVICE_DAILY_CAP` (30) per device and `GLOBAL_DAILY_CAP` (500) in total. A counter goes up before the request is forwarded, and its key expires after 3 days.
- Per-network cap: `IP_DAILY_CAP` (60, set in wrangler.toml) per public IP. The IP is never stored. The key is `i:<day>:<first 16 bytes of SHA-256(IP_SALT + "\0" + CF-Connecting-IP)>`, and `IP_SALT` is a secret (`openssl rand -hex 32 | tr -d '\n' | npx wrangler secret put IP_SALT`). A request is refused if **any** cap (device, network or global) is reached. The owner token bypasses all of them. `/status` also returns `network: { used, cap }`, and `remaining` is the smallest of the three.
- Burst limit: the optional `COACH_RL` rate-limit binding (`[[ratelimits]]`, 10 requests per 60 s per hashed IP, counted per Cloudflare location) returns 429 `rate_limited`.
- Caveats: people behind one public IP (home Wi-Fi, CGNAT on mobile, offices) share the 60. Someone who rotates IPs (VPN, some carriers) can get round it. KV is eventually consistent, so counts can be off by a few under parallel bursts.
- Input caps: `MAX_MESSAGES` (40) and `MAX_INPUT_CHARS` (24000).
- `KILL_SWITCH = "1"` makes every request return 503 `disabled`.
- Errors are JSON: `{ error, message, ... }`. The error codes are `origin_not_allowed`, `bad_device`, `bad_request`, `too_long`, `device_limit`, `ip_limit`, `global_limit`, `rate_limited`, `disabled`, `est_limit`, `est_ip_limit`, `bad_image`, `bad_estimate`, `no_food`, `upstream_error`, `upstream_unreachable`, `not_found` and `misconfigured`. Responses also carry the headers `X-Coach-Remaining`, `X-Coach-Cap` and `X-Coach-Reset`.

The device ID is not authentication: a determined user can rotate it, and a non-browser client can fake `Origin`. The global cap is what limits total spend. KV is eventually consistent, so under bursts of parallel requests the counts can overshoot a cap slightly.

## Deploy

```sh
export PATH=~/.local/node22/bin:$PATH      # wrangler 4 needs Node ≥ 20
cd coach-proxy && npm ci
npx wrangler login                          # or CLOUDFLARE_API_TOKEN
npx wrangler kv namespace create COACH_KV   # paste the id into wrangler.toml
printf '%s' "$XAI_API_KEY" | npx wrangler secret put XAI_API_KEY   # never echo or commit the key
openssl rand -hex 24 > ~/.grug-coach-owner-token && chmod 600 ~/.grug-coach-owner-token
npx wrangler secret put OWNER_TOKEN < ~/.grug-coach-owner-token
npx wrangler deploy                         # prints https://grug-coach-proxy.<subdomain>.workers.dev
```

Then set `COACH_PROXY_URL` in `../src/coach.ts` to the printed URL.

Change caps, the model or the kill switch in `[vars]` in `wrangler.toml` and run `npx wrangler deploy` again. Or edit the variables in the Cloudflare dashboard (Workers → grug-coach-proxy → Settings → Variables).

Logs: `npx wrangler tail`.

Live today: `https://grug-coach-proxy.grug-fitgrug-fitgrug-fit.workers.dev`

## Test

- `npm test` runs the unit tests (`test/unit.mjs`). They import the Worker with an in-memory KV and a mocked upstream.
- `./test/dev-smoke.sh` is an end-to-end check with no key and no cost. It starts `test/mock-upstream.mjs` on port 8788 and runs `wrangler dev --local` on port 8787 using `.dev.vars` (copied from `.dev.vars.example`, which points `UPSTREAM_URL` at the mock). Then it curls `/status`, `/chat`, a stream, a request with no Origin, and the owner bypass.

Manual check:

```sh
curl -H 'Origin: http://localhost:5173' -H 'X-Device-Id: 3f0b6a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b' http://127.0.0.1:8787/status
```
