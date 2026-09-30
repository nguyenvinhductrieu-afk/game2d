# Production Upgrade — v0.3.0

## What changed

### Network
- Client-side prediction for the local player.
- Server reconciliation using `PlayerState.lastProcessedInputSeq`.
- Remote-player interpolation buffer with ~100 ms render delay.
- Server-authoritative movement; client sends intent only.
- Input packet validation + 20 ms minimum server-side acceptance interval.
- 30 s reconnect grace window. A transport disconnect no longer immediately destroys the in-memory player session.
- Persistence is triggered on disconnect and serialized per user to prevent overlapping saves from racing.

### Server performance
- Grid-based spatial hash for players and enemies.
- Player/enemy AoI queries avoid scanning every entity for every viewer.
- Socket.IO per-message deflate is enabled for payloads >= 1 KB.
- MongoDB connection establishment is serialized so concurrent requests do not race `mongoose.connect()`.

### Client lifecycle
- `SocketClient.close()` distinguishes intentional scene shutdown from network failure.
- Remote player objects own their interpolation buffer and are destroyed with the scene.
- Virtual joystick is idempotent, handles `pointerupoutside`, supports one active touch while allowing other touches elsewhere, and applies a deadzone.

### Security / anti-cheat
- Movement speed is clamped on the server.
- Server ignores movement from a socket that is no longer the authenticated owner of the player.
- Server validates sequence numbers, finite movement values, ranges, enum values, item IDs and quantities.
- Collision currently enforces world bounds. The current project has no authoritative obstacle/tile collision map, so full noclip prevention requires adding server-side collision geometry next.

## Important production caveats

1. The reconnect grace state is process-local. For multiple server instances, move session ownership/grace state to Redis and use a Socket.IO adapter.
2. `localStorage` JWTs are acceptable for this MVP but a production web deployment should prefer short-lived access tokens plus an HttpOnly/Secure refresh cookie.
3. Snapshot compression reduces bandwidth but does not replace delta snapshots. At large player counts, add snapshot baselines/deltas and per-AoI rooms.
4. The current map has only rectangular world bounds. Add the same collision grid used by the client to the server before shipping complex obstacles.
5. REST/socket rate limits are process-local. Use Redis for horizontally scaled deployments.

## Validation in the inspection environment

- `shared` TypeScript build: **passed** with the available TypeScript compiler.
- Changed TypeScript source files: **syntax parse passed**.
- Full dependency-backed client/server build: **not completed**, because dependency installation timed out in the inspection environment. The repository's existing dependencies were not available locally.

## v0.3.0 bug-fix patch — 24 issues

1. Arcade physics world is explicitly `2400x1600`; remote players no longer stop at 1280x720.
2. Reconnect resets `lastSeq`/`lastProcessedInputSeq` and the client sequence on reconnect.
3. SpatialHash removes the old socket ID before replacing `p.id`.
4. Authentication has a disconnect race guard and cleans up sockets that die during auth.
5. Registration no longer depends on MongoDB transactions; standalone MongoDB works.
6. Farm data is private/instanced at the snapshot layer; players only receive their own farm tiles/crops.
7. `combat:fx` now has a client listener and is AoI-filtered.
8. Simulation remains 20Hz; world/character snapshots are emitted at 5Hz.
9. Skill hit detection uses `enemyGrid` instead of scanning every enemy.
10. Connect failures no longer delete a valid token after five retries; token is retained for reconnect/server restart.
11. Character persistence uses `upsert:true` to avoid silent loss when the Character document is missing.
12. Express uses configurable `TRUST_PROXY` so `req.ip` works behind a reverse proxy.
13. `seedDemoEnemies()` clears both the enemy map and enemy spatial index.
14. Farm key parsing requires exactly `ownerId:gx:gy` with integer bounded coordinates.
15. World/farm constants are centralized in `/shared`; client/server import the same values.
16. Mobile action buttons are compacted to four columns; quest actions moved into a dedicated quest panel.
17. Chat keeps the last six lines; system messages append instead of replacing chat.
18. Weapons are unique inventory items; duplicate weapon purchases/stacks are rejected.
19. Quest panel exposes claim buttons for all quests, including `first_goblins` and `wheat_harvest`.
20. Crop `ready` state is derived from `plantedAt` on restore/snapshot, so mature crops render as mature after login.
21. `SERVER_URL` defaults to same-origin instead of rewriting ports, so HTTPS deployment without an explicit port works.
22. Remote snapshots omit full combat/economy stats; Zod uses current top-level `z.email()`/`z.uuid()` APIs.
23. Server simulation uses a fixed 20Hz timestep with a bounded accumulator to handle event-loop drift.
24. `Character.userId` has an explicit unique index in the Mongoose schema.
