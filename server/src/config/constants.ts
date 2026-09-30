import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MOVE_SPEED as SHARED_MOVE_SPEED, WORLD_H as SHARED_WORLD_H, WORLD_W as SHARED_WORLD_W, WORLD_PLAYER_MARGIN } from '@farm-dungeon/shared';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootEnv = resolve(serverDir, '..', '.env');
const serverEnv = resolve(serverDir, '.env');
dotenv.config({ path: rootEnv });
dotenv.config({ path: serverEnv, override: false });

export const PORT = Number(process.env.PORT || 3000);
export const TICK_RATE = 20;
export const SNAPSHOT_RATE = 5;
export const WORLD_W = SHARED_WORLD_W;
export const WORLD_H = SHARED_WORLD_H;
export const PLAYER_SPEED = SHARED_MOVE_SPEED;
export const PLAYER_MARGIN = WORLD_PLAYER_MARGIN;
export const JWT_SECRET = process.env.JWT_SECRET || '';
export const MONGO_URI = process.env.MONGO_URI || '';
export const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(v=>v.trim()).filter(Boolean);
export const TRUST_PROXY = process.env.TRUST_PROXY === 'false' ? false : (process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || 1 : 1);

if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be set to at least 32 characters.');
