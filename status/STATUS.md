# ForecastEx status feed

View-only operations page for contracted ForecastEx products. Lives at `/status/` on the static GitHub Pages site. There is no control surface: no arm, cancel, flatten, restart, or any other write action.

The marketing homepage stays public. This page is gated by a client-side password check, then polls `data.json`.

## Password (Scott)

The page never stores a plaintext password. It SHA-256 hashes what you type and compares it to `STATUS_PASSWORD_SHA256` in [`config.js`](config.js).

The live unlock hash is already set in [`config.js`](config.js) (`passwordSha256`). The plaintext password is not in this repo.

To rotate the password:

```bash
node status/hash-password.js 'your-password-here'
```

Paste the printed hex digest into `status/config.js`:

```js
window.STATUS_CONFIG = {
  passwordSha256: "<paste hex here>",
  dataUrl: "data.json",
  refreshMs: 20000
};
```

Commit and push. After unlock, the browser keeps a session flag in `sessionStorage` (cleared when the tab closes, or via Lock).

Optional: generate the hash from an env var and substitute at deploy time.

```bash
export STATUS_PASSWORD_SHA256="$(node status/hash-password.js "$STATUS_PASSWORD")"
# then rewrite config.js passwordSha256 from $STATUS_PASSWORD_SHA256
```

Do not commit the plaintext password.

### What this gate is (and is not)

GitHub Pages files are public. Anyone who knows the URL can fetch [`data.json`](data.json) even without the password. The hash only hides the rendered dashboard.

If the feed must stay private, do one of the following on the Dell publisher side:

1. Push `data.json` to a host that requires auth (and set `dataUrl` in `config.js` to that URL, with CORS allowed for `https://torussystems.io`).
2. Put Cloudflare Access (or Cloudflare Basic Auth) in front of `/status/` only. This repo has no Cloudflare config today; the live site is GitHub Pages + a `CNAME`.

## Publisher contract

An external process (Dell box) overwrites `status/data.json` on a cadence of about 15–30 seconds. The page fetches that file after unlock (`cache: "no-store"`, cache-busted query string).

Write atomically: write `data.json.tmp`, then rename to `data.json`, so readers never see a partial file.

### Top-level object

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `ts` | ISO-8601 string | yes | Feed timestamp (UTC recommended, `Z` suffix). Shown as last update. |
| `release_sha` | string | no | Quoter / poller git SHA. Shown in the book header. |
| `poller` | object | no | `{ "ok": true, "age_s": 3.9 }` — poller heartbeat. |
| `products` | object | yes | Map of product code → product object. |
| `sample` | boolean | no | If `true`, UI labels the feed as sample / mock. |

Unknown top-level fields are ignored.

### Products

Always publish these six econ-book codes when the engine knows about them. Missing codes render as `UNKNOWN`.

`FFDEC` · `CPIC` · `CPIY` · `PCEY` · `UNR` · `CAUNR`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `engine_state` | string | preferred | `QUOTING` \| `BOUND` \| `DARK` \| `HALTED` \| `FLAT` \| `UNKNOWN`. Case-insensitive; other strings display as-is and count as unknown for book color. |
| `session` | string | no | Session / auth hint (`BOUND`, `AUTH_OK`, `IDLE`, …). |
| `auth` | string | no | Alternate session hint if `session` is absent. |
| `resting` | number | no | Resting order count. |
| `collateral` | number | no | Collateral (display as provided). |
| `locked` | number | no | Locked collateral. |
| `absent_s_today` | number | no | Seconds absent so far today. |
| `presence_pct` | number | no | Presence percent 0–100. If omitted, the page estimates from `absent_s_today` vs elapsed UTC day. |
| `arm_valid_until` | ISO-8601 string | no | Arm token expiry. |
| `fairs_stale` | boolean | no | `true` → stale fairs; `false` → fresh. |
| `fairs` | string | no | Alternate: `"fresh"` or `"stale"`. |
| `snapshot_age_s` | number | no | Age of this product snapshot in seconds. Else derived from `ts` or the book `ts`. |
| `ts` | ISO-8601 string | no | Product-level last snapshot time. |
| `pid` | number | no | Engine PID, shown as a hint only. |

Omit a field rather than inventing a value. The UI shows an em dash for absent metrics.

### Example

```json
{
  "ts": "2026-09-08T04:11:28Z",
  "release_sha": "53c5f59…",
  "poller": {"ok": true, "age_s": 3.9},
  "products": {
    "CPIC": {
      "engine_state": "QUOTING",
      "session": "BOUND",
      "resting": 34,
      "collateral": 8450,
      "locked": 0,
      "absent_s_today": 688.9,
      "arm_valid_until": "2026-09-09T04:11:27Z",
      "fairs_stale": true,
      "pid": 22116
    },
    "FFDEC": {"engine_state": "DARK", "resting": 0}
  }
}
```

A checked-in sample lives at [`data.json`](data.json) so `/status/` works in preview.

## Book color

Computed in the browser from the latest feed. No publisher field required.

- **Red** — poller `ok` is false, poller age &gt; 60s, feed age &gt; 90s, or any product is `HALTED`.
- **Amber** — any product `DARK` / `FLAT` / `UNKNOWN` / missing, any stale fairs, poller age &gt; 15s, or feed age &gt; 30s.
- **Green** — otherwise, when the poller looks healthy and the six names are present without those faults.

## Local preview

```bash
python3 -m http.server 8080
```

Open `http://127.0.0.1:8080/status/` and unlock with the configured password (hash in `config.js`).
