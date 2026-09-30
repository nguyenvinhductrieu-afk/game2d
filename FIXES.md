# Fix & Improvement Notes — v0.3.0

## Fixed

- Fixed `shop:sell` item-loss bug: the server now verifies the requested quantity is available before mutating inventory.
- Added sell validation for player state and quantity bounds.
- Added per-player world snapshot filtering using an interest radius so each client does not receive the entire world state.
- Kept the player's own farm fully visible while filtering distant farms/crops.
- Reduced `character:state` broadcast frequency from 20 Hz to 5 Hz. Action handlers still send immediate character updates after mutations.
- Added proper `VirtualJoystick` listener cleanup on scene shutdown and resize.
- Made joystick destruction idempotent to avoid duplicate cleanup.

## Architecture improvements

- `World.snapshotForPlayer(playerId)` is now the preferred world-state API.
- Existing `World.snapshot()` remains for compatibility and delegates to the first connected player.
- The existing Socket.IO event contract remains unchanged, so client/server protocol compatibility is preserved.

## Validation performed

- `shared/tsconfig.json` compiles successfully with TypeScript 5.8.3 available in the inspection environment.
- TypeScript source syntax/transpile inspection passed for all runtime `.ts` source files (declaration-only `vite-env.d.ts` excluded).
- Full dependency installation could not be completed in the inspection environment because `npm install --ignore-scripts --no-audit --no-fund` timed out. Therefore a complete dependency-backed client/server production build could not be truthfully claimed here.

## Recommended before production

- Run `npm ci` (or `npm install`) in a normal networked CI environment.
- Run `npm run build` at repository root.
- Add automated unit tests for economy, farming, combat and persistence.
- Move rate limiting/session coordination to Redis when running multiple server instances.
- Replace localStorage JWT storage with an HttpOnly/Secure refresh-cookie architecture for production hardening.
