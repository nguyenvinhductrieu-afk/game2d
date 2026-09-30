# Farm & Dungeon Online — Fixed MVP

Bản này sửa các lỗi build/runtime/security/logic được rà soát ở v3.

## Requirements
- Node.js 24 LTS
- MongoDB local standalone hoặc MongoDB Atlas
- npm

## Environment
Tạo `.env` ở **root project** (cạnh package.json) hoặc `server/.env`.

```env
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/farm_dungeon_online
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters-long
CLIENT_ORIGIN=http://localhost:5173
VITE_SERVER_URL=http://localhost:3000
```

Không có MONGO_URI hoặc JWT_SECRET hợp lệ, server **fail fast** với lỗi rõ ràng thay vì chạy nửa vời rồi login 503.

> Register không dùng MongoDB transaction, nên MongoDB standalone mặc định vẫn đăng ký được. Nếu tạo User thành công nhưng tạo Character thất bại, server sẽ rollback User.

## Build / Run

```bash
npm install
npm run build
npm run dev
```

Client: `http://localhost:5173`

Điện thoại cùng LAN:
```env
CLIENT_ORIGIN=http://localhost:5173,http://YOUR_PC_LAN_IP:5173
VITE_SERVER_URL=http://YOUR_PC_LAN_IP:3000
```
`CLIENT_ORIGIN` có thể chứa nhiều origin, ngăn cách bằng dấu phẩy. Vite đọc `.env` ở root nhờ `envDir: '..'`, và dev server đã `host: true`.

## Đã sửa

### Build/runtime
- `seedDemoEnemies()` tồn tại và được gọi đúng.
- `useSkill()` luôn trả `{ok,msg,hits}` phù hợp TypeScript.
- Remote player dùng `Phaser.Physics.Arcade.Sprite`, không gọi physics methods trên ordinary Sprite.
- Có `vite-env.d.ts`.
- Client `tsconfig` có `noEmit: true`.
- `.env` được đọc ổn định từ root hoặc server, không phụ thuộc `cwd`.
- Vite `envDir: '..'` nên `VITE_SERVER_URL` trong root `.env` được đọc đúng.
- Client dùng `VITE_SERVER_URL`, không hard-code localhost.
- LAN CORS nhận nhiều `CLIENT_ORIGIN` và README có cấu hình đúng cho điện thoại.
- Mongoose models có generic types rõ ràng.
- Express async handlers có `Promise<void>` và không trả response object.
- `shutdown` được đăng ký bằng Phaser scene shutdown event.

### Logic
- Disconnect handler được đăng ký ngay khi socket kết nối, trước mọi `await`.
- Khóa xác thực theo `userId` tuần tự hóa hai login đồng thời; session cũ được persist rồi disconnect.
- Socket ngắt trong lúc authenticate không được add vào world.
- Input tự reset sau 750ms nếu client ngừng gửi.
- Skill không thuộc weapon bị từ chối.
- Skill khi đứng yên dùng `player.dir`.
- Attack/Dash/Skill buttons lấy skill theo weapon.
- Quest `deliver` có event `quest:deliver` và trừ item thật.
- Quest claim dùng chung `addExp`, nên level-up ngay.
- HP/MP regen; player chết được respawn.
- Stamina được dùng cho dash và farming.
- Farming có hoe -> plant -> water -> harvest; kiểm tra khoảng cách/vùng farm và lưu `farmTiles` + crops theo `userId`.
- Farm memory được dọn khi người chơi rời world; dữ liệu được restore từ DB khi đăng nhập lại.
- Inventory loại stack `quantity <= 0` trước khi lưu, tránh Mongoose `min:1` làm hỏng persistence.
- Drops có pickup handler + khoảng cách + inventory validation.
- Enemy chết được dọn và respawn.
- Bán weapon đang equip bị chặn.
- Register dùng Mongo transaction.
- Rate limit REST login/register và Socket skill/farm/chat.
- Lỗi API không trả `e.message` cho client.
- `/health` dùng `isDBConnected()`.

### Client
- Connect error/disconnect quay lại Login.
- Login/Register submit bằng Enter.
- Password autocomplete đổi theo mode.
- Input HTML được cleanup khi scene shutdown.
- Joystick chỉ hiện trên mobile/touch/screen nhỏ.
- Client gửi input 20Hz thay vì 60Hz.
- W/A/S/D không capture mặc định, nên chat có thể gõ chữ bình thường.
- Crop và ô đất đã cuốc được render; UI có wheat/carrot, skill 2/3, dash theo weapon và equip sword/bow/staff.
- Local player prediction không vừa velocity vừa lerp mạnh mỗi snapshot.
- `updateHud()` an toàn nếu weapon definition thiếu.
- Có UI MVP cho combat, farming, shop, equip, quest delivery/claim và world chat.

## Security notes
- JWT secret không có fallback trong production.
- Client vẫn lưu JWT trong localStorage ở MVP. Production nên chuyển sang secure HttpOnly refresh-token cookie.
- Server authoritative: client chỉ gửi intent.
- Rate limit hiện là in-memory; production nên chuyển sang Redis.
- Snapshot full-world vẫn là MVP; production nên dùng interest management/delta snapshots/rooms.
- Broadcast world/combat/chat chỉ gửi tới socket đã xác thực.
- `ITEM_DEFS`, `WEAPON_DEFS`, `SKILL_DEFS`, `QUEST_DEFS` dùng `Object.hasOwn` khi tra theo input client.
- Rate-limit buckets có cleanup định kỳ; Mongoose connection state cập nhật cả khi disconnect/error.
- Shutdown gọi `io.close()` và có timeout cho HTTP close.

## Production fixes in this build
- Arcade Physics bounds explicitly set to 2400x1600.
- Reconnect resets input sequence and repairs SpatialHash old socket IDs.
- Auth disconnect race is cleaned up before/after character load.
- Register works on standalone MongoDB; Character persistence uses upsert.
- Farms are private/instanced at the snapshot layer: each player receives only their own farm tiles/crops.
- Combat FX has a client listener and is AoI-filtered.
- World simulation remains 20Hz fixed-step; snapshots are emitted at 5Hz.
- Skill hit detection uses enemy spatial hash.
- Proxy-aware Express rate limiting via TRUST_PROXY.
- Remote player payloads no longer include full combat/economy stats.
- Weapon inventory is unique; duplicate weapon purchases/stacks are rejected.
- Crop readiness is restored from plantedAt and rendered as ready after growth.
- Mobile controls are compacted into four columns and quests are opened in a dedicated panel.
- Chat keeps multiple lines and system messages no longer overwrite chat.
