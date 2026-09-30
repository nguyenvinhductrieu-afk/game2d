# Production Bug-Fix Test Plan

## Build
1. `npm install`
2. `npm run build`
3. Confirm shared, server and client TypeScript builds succeed.

## 1 — Physics bounds
- Put player A beyond x=1280 and y=720.
- Move player B around the same area.
- Confirm B continues to x≈2400/y≈1600 without sticking at 1280×720.

## 2 — Reconnect sequence
- Login.
- Move for 1–2 minutes so sequence is several hundred/thousand.
- Refresh the page within 30 seconds.
- Confirm movement works immediately; no need to wait for grace expiry.

## 3 — SpatialHash reconnect leak
- Connect → disconnect → refresh 10–20 times within grace.
- Confirm exactly one player entity is visible.
- Confirm enemy targeting does not target a disconnected ghost.

## 4 — Auth disconnect race
- Throttle network heavily.
- Start socket authentication and immediately disable network.
- Confirm no ghost player remains in the server world after the socket closes.

## 5 — Standalone MongoDB register
- Run MongoDB without replica set.
- Register a new account.
- Confirm HTTP 201 and a Character document are created.

## 6 — Private farm instance
- Login with two accounts.
- Both can prepare the same local farm coordinates without seeing each other's tiles/crops.
- Reconnect each account and confirm only its own farm returns.

## 7 — Combat FX
- Two players stand near each other and one attacks.
- Confirm attacker/nearby player sees the FX.
- Put another player outside AoI and confirm they receive no FX event.

## 8 — Snapshot frequency
- Add a temporary client counter for `world:snapshot`.
- Confirm approximately 5 snapshots/second, while server simulation remains 20 ticks/second.

## 9 — Skill spatial hash
- Spawn many enemies.
- Use melee/AoE skills.
- Confirm only enemies in the skill query radius can be hit.

## 10 — Token retention
- Stop/restart the server.
- Keep the browser on MainScene.
- Confirm the client retries without deleting localStorage token.
- When server returns, the player reconnects automatically.

## 11 — Persistence upsert
- Delete a Character document for a logged-in user while testing.
- Trigger persistence.
- Confirm a Character document is recreated rather than silently ignored.

## 12 — Proxy IP rate limit
- Run behind nginx/Cloudflare/reverse proxy.
- Confirm different client IPs produce different rate-limit buckets when `TRUST_PROXY` is configured correctly.

## 13 — Enemy seed/reset
- Call `seedDemoEnemies()` twice in a test harness.
- Confirm exactly the expected number of enemies and no stale spatial-grid entries.

## 14 — Farm key validation
- Send malformed farm keys such as `user::`, `user:1:`, `user:1:1:extra`.
- Confirm they are ignored/rejected.

## 15 — Shared constants
- Search the client/server for duplicate `2400`, `1600`, `300`, `250`, `48` farm/world constants.
- Only shared constants should define these values.

## 16 — Mobile UI
- Test 360×640 and 390×844.
- Confirm the four-column action bar stays above the chat input.
- Open Quests and confirm the panel fits the viewport.

## 17 — Chat
- Send 6+ messages.
- Trigger system errors.
- Confirm previous chat lines remain visible and system messages append.

## 18 — Unique weapons
- Buy the same weapon twice.
- Confirm the second purchase is rejected and inventory contains one stack/item.

## 19 — Quest claims
- Complete `first_goblins` and `wheat_harvest`.
- Open Quests.
- Confirm CLAIM appears and can only be used once.

## 20 — Crop restore
- Plant + water a crop.
- Wait until growth completes.
- Refresh/reconnect.
- Confirm the crop displays as ready/mature and can be harvested.

## 21 — HTTPS URL
- Deploy client and server behind HTTPS with no `:3000` in the browser URL.
- Confirm default Socket.IO URL remains same-origin unless `VITE_SERVER_URL` explicitly overrides it.

## 22 — Remote payload privacy
- Inspect `world:snapshot` for another player.
- Confirm their full HP/MP/attack/defense/gold/inventory are absent.

## 23 — Server load drift
- Block the event loop for >250ms in a controlled test.
- Confirm the fixed-step loop resumes without an unbounded catch-up spiral.

## 24 — Character uniqueness
- Verify the MongoDB `Character.userId` unique index exists.
- Attempt to create two characters for the same user and confirm the second is rejected.
