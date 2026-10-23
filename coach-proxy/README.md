# Grug Coach proxy (Cloudflare Worker)

A small proxy that lets the Grug Fit app talk to xAI without shipping an API key to the browser.

- `POST /chat` forwards `{ messages, model?, stream? }` to `UPSTREAM_URL` (default `https://api.x.ai/v1/chat/completions`). All other fields are dropped, `max_tokens` is forced to `MAX_TOKENS`, and the model must be in `ALLOWED_MODELS` (it defaults to `MODEL`). SSE streams are passed straight through.
- `GET /status` returns `{ enabled, owner, remaining, cap, used, resetAt, model }` for the calling device.
- Every request needs an allowed `Origin` (`ALLOWED_ORIGINS`) and an `X-Device-Id` UUID. With `X-Owner-Token: <OWNER_TOKEN>`, the daily caps don't apply.
- Daily caps are counted in Workers KV per UTC day: `DEVICE_DAILY_CAP` (30) per device and `GLOBAL_DAILY_CAP` (500) in total. A counter goes up before the request is forwarded, and its key expires after 3 days.
- Input caps: `MAX_MESSAGES` (40) and `MAX_INPUT_CHARS` (24000).
- `KILL_SWITCH = "1"` makes every request return 503 `disabled`.
- Errors are JSON: `{ error, message, ... }`. The error codes are `origin_not_allowed`, `bad_device`, `bad_request`, `too_long`, `device_limit`, `global_limit`, `disabled`, `upstream_error`, `upstream_unreachable`, `not_found` and `misconfigured`. Responses also carry the headers `X-Coach-Remaining`, `X-Coach-Cap` and `X-Coach-Reset`.

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
