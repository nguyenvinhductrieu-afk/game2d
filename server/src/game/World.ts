import { randomUUID } from 'node:crypto';
import {
  AOI_RADIUS, FARM_SIZE, ITEM_DEFS, QUEST_DEFS, SKILL_DEFS, WEAPON_DEFS,
  type CharacterSnapshot, type CropState, type DropState, type EnemyState,
  type InputState, type PlayerState, type RemotePlayerState, type QuestProgress, type WorldSnapshot
} from '@farm-dungeon/shared';
import { PLAYER_SPEED, WORLD_H, WORLD_W, PLAYER_MARGIN } from '../config/constants.js';
import { ENEMY_ATTACK_RANGE, ENEMY_DAMAGE, ENEMY_SPEED, GROWTH_MS, FARM_ORIGIN, FARM_TILE } from './definitions.js';
import { Character, type ISavedCrop } from '../models.js';
import { logger } from '../logger.js';

export type ServerPlayer = PlayerState & {
  lastSeq:number; lastInputAt:number; lastInputReceivedAt:number; inputX:number; inputY:number;
  cooldowns:Map<string,number>; gold:number; inventory:{uid:string;itemId:string;quantity:number}[];
  quests:QuestProgress[]; userId?:string; socketId?:string;
};

type GridEntry={id:string;x:number;y:number};
class SpatialHash<T extends GridEntry>{
  private readonly cells=new Map<string,Set<string>>();
  private readonly byId=new Map<string,T>();
  constructor(private readonly cellSize=256){}
  private key(x:number,y:number){return `${Math.floor(x/this.cellSize)}:${Math.floor(y/this.cellSize)}`}
  clear(){this.cells.clear();this.byId.clear()}
  upsert(value:T){this.remove(value.id);this.byId.set(value.id,value);const k=this.key(value.x,value.y);let set=this.cells.get(k);if(!set){set=new Set();this.cells.set(k,set)}set.add(value.id)}
  remove(id:string){const old=this.byId.get(id);if(!old)return;const k=this.key(old.x,old.y);const set=this.cells.get(k);set?.delete(id);if(set?.size===0)this.cells.delete(k);this.byId.delete(id)}
  query(x:number,y:number,radius:number){const minX=Math.floor((x-radius)/this.cellSize),maxX=Math.floor((x+radius)/this.cellSize),minY=Math.floor((y-radius)/this.cellSize),maxY=Math.floor((y+radius)/this.cellSize);const out:T[]=[];const seen=new Set<string>();for(let cy=minY;cy<=maxY;cy++)for(let cx=minX;cx<=maxX;cx++){const set=this.cells.get(`${cx}:${cy}`);if(!set)continue;for(const id of set){if(seen.has(id))continue;seen.add(id);const v=this.byId.get(id);if(v&&Math.hypot(v.x-x,v.y-y)<=radius)out.push(v)}}return out}
}

export class World{
  players=new Map<string,ServerPlayer>();
  enemies=new Map<string,EnemyState>();
  crops=new Map<string,CropState>();
  drops=new Map<string,DropState>();
  private now=Date.now(); private enemySpawnTimer=0;
  private readonly tilled=new Set<string>(); private readonly enemyAttackAt=new Map<string,number>();
  private readonly playerGrid=new SpatialHash<ServerPlayer>(256); private readonly enemyGrid=new SpatialHash<EnemyState>(256);
  private readonly inputTimeoutMs=750; private readonly reconnectGraceMs=30_000;
  private readonly reconnectTimers=new Map<string,ReturnType<typeof setTimeout>>();
  private readonly persistLocks=new Map<string,Promise<void>>();
  private readonly spawnPoints=[{x:1450,y:500},{x:1600,y:620},{x:1750,y:480},{x:1880,y:720},{x:1500,y:1000},{x:1700,y:1120},{x:1950,y:980},{x:2100,y:820}];

  addPlayer(id:string,name:string,existing?:Partial<ServerPlayer>,userId?:string){
    const now=Date.now();
    const p:ServerPlayer={id,name,x:existing?.x??WORLD_W/2,y:existing?.y??WORLD_H/2,dir:existing?.dir??'down',moving:false,
      stats:existing?.stats??{level:1,exp:0,expToNext:100,hp:100,maxHp:100,mp:60,maxMp:60,stamina:100,maxStamina:100,attack:10,defense:5,moveSpeed:PLAYER_SPEED},
      weaponId:existing?.weaponId??'iron_sword',lastSeq:0,lastProcessedInputSeq:0,lastInputAt:now,lastInputReceivedAt:0,inputX:0,inputY:0,cooldowns:new Map(),gold:existing?.gold??250,
      inventory:existing?.inventory??[{uid:randomUUID(),itemId:'wheat_seed',quantity:5},{uid:randomUUID(),itemId:'iron_sword',quantity:1}],
      quests:existing?.quests??Object.keys(QUEST_DEFS).map(questId=>({questId,progress:0,completed:false,claimed:false})),userId,socketId:id};
    this.players.set(id,p);this.playerGrid.upsert(p);return p;
  }

  attachPlayer(userId:string,socketId:string){
    const p=this.getPlayerByUserId(userId);if(!p)return undefined;
    const timer=this.reconnectTimers.get(userId);if(timer){clearTimeout(timer);this.reconnectTimers.delete(userId)}
    const oldKey=p.id;
    // Remove the old spatial-hash entry BEFORE changing p.id. Otherwise upsert(newId) leaves oldId behind.
    this.playerGrid.remove(oldKey);
    this.players.delete(oldKey);
    p.id=socketId;p.socketId=socketId;p.lastSeq=0;p.lastProcessedInputSeq=0;p.lastInputAt=Date.now();p.lastInputReceivedAt=0;p.inputX=0;p.inputY=0;p.moving=false;
    this.players.set(socketId,p);this.playerGrid.upsert(p);return p;
  }

  detachPlayer(id:string){
    const p=this.players.get(id);if(!p)return;
    p.socketId=undefined;p.inputX=0;p.inputY=0;p.moving=false;this.playerGrid.upsert(p);
    const oldId=p.id;
    if(p.userId){
      const uid=p.userId;const previous=this.reconnectTimers.get(uid);if(previous)clearTimeout(previous);
      const timer=setTimeout(()=>{this.reconnectTimers.delete(uid);const current=this.getPlayerByUserId(uid);if(current===p&&!p.socketId)this.removePlayer(current.id)},this.reconnectGraceMs);
      this.reconnectTimers.set(uid,timer);
    }else this.removePlayer(oldId);
  }

  removePlayer(id:string){
    const p=this.players.get(id);if(!p)return;
    this.playerGrid.remove(p.id);this.players.delete(id);
    if(p.userId){
      const timer=this.reconnectTimers.get(p.userId);if(timer){clearTimeout(timer);this.reconnectTimers.delete(p.userId)}
      // Farm data is intentionally retained in MongoDB; only the in-memory instance is removed after grace expiry.
      const prefix=`${p.userId}:`;for(const key of [...this.tilled])if(key.startsWith(prefix))this.tilled.delete(key);
      for(const [cropId,c] of this.crops)if(c.ownerId===p.userId)this.crops.delete(cropId);
    }
  }

  getPlayer(id:string){return this.players.get(id)}
  getPlayerByUserId(userId:string){for(const p of this.players.values())if(p.userId===userId)return p}
  playersNear(x:number,y:number,radius:number){return this.playerGrid.query(x,y,radius).filter(p=>!!p.socketId)}
  expForLevel(level:number){return Math.round(100*Math.pow(1.35,Math.max(0,level-1)))}

  restoreFarm(userId:string,tiles:string[],crops:ISavedCrop[]){
    for(const t of tiles){const parsed=this.parseFarmKey(t);if(parsed&&parsed.ownerId===userId)this.tilled.add(this.farmKey(userId,parsed.gx,parsed.gy));}
    for(const c of crops)if(c.ownerId===userId)this.crops.set(c.id,{...c,ownerId:userId,ready:this.isCropReady(c)});
  }

  private parseFarmKey(key:string){
    const parts=key.split(':');if(parts.length!==3)return undefined;
    const [ownerId,gxRaw,gyRaw]=parts;const gx=Number(gxRaw),gy=Number(gyRaw);
    if(!ownerId||!Number.isInteger(gx)||!Number.isInteger(gy)||gx<0||gy<0||gx>=FARM_SIZE||gy>=FARM_SIZE)return undefined;
    return{ownerId,gx,gy};
  }
  farmKey(ownerId:string,gx:number,gy:number){return `${ownerId}:${gx}:${gy}`}
  private isCropReady(c:CropState){return this.now-c.plantedAt>=GROWTH_MS}

  applyInput(id:string,input:InputState){
    const p=this.players.get(id),now=Date.now();
    if(!p||p.stats.hp<=0||p.socketId!==id||!Number.isSafeInteger(input.seq)||input.seq<=p.lastSeq)return;
    if(p.lastInputReceivedAt&&now-p.lastInputReceivedAt<20)return;
    let x=input.x,y=input.y;const len=Math.hypot(x,y);if(!Number.isFinite(len))return;if(len>1){x/=len;y/=len}
    p.inputX=x;p.inputY=y;p.lastSeq=input.seq;p.lastProcessedInputSeq=input.seq;p.lastInputAt=now;p.lastInputReceivedAt=now;
    if(Math.abs(x)>Math.abs(y))p.dir=x>=0?'right':'left';else if(Math.abs(y)>.01)p.dir=y>=0?'down':'up';
  }

  tick(dt:number){
    this.now=Date.now();this.enemySpawnTimer+=dt;
    if(this.enemySpawnTimer>=5){this.enemySpawnTimer=0;this.respawnEnemies();}
    for(const p of this.players.values()){
      if(p.stats.hp<=0)continue;
      if(Date.now()-p.lastInputAt>this.inputTimeoutMs){p.inputX=0;p.inputY=0;}
      const speed=Math.min(Math.max(0,p.stats.moveSpeed),PLAYER_SPEED*1.5);
      const nextX=Math.max(PLAYER_MARGIN,Math.min(WORLD_W-PLAYER_MARGIN,p.x+p.inputX*speed*dt));
      const nextY=Math.max(PLAYER_MARGIN,Math.min(WORLD_H-PLAYER_MARGIN,p.y+p.inputY*speed*dt));
      if(Number.isFinite(nextX)&&Number.isFinite(nextY)){p.x=nextX;p.y=nextY;}
      this.playerGrid.upsert(p);p.moving=Math.hypot(p.inputX,p.inputY)>.01;
      p.stats.stamina=Math.min(p.stats.maxStamina,p.stats.stamina+15*dt);p.stats.mp=Math.min(p.stats.maxMp,p.stats.mp+5*dt);p.stats.hp=Math.min(p.stats.maxHp,p.stats.hp+1*dt);
    }
    this.updateEnemies(dt);this.cleanupDrops();
  }

  private updateEnemies(dt:number){
    for(const e of this.enemies.values()){
      if(!e.alive)continue;let target:ServerPlayer|undefined,best=Infinity;
      for(const p of this.playerGrid.query(e.x,e.y,360)){if(p.stats.hp<=0||!p.socketId)continue;const d=Math.hypot(p.x-e.x,p.y-e.y);if(d<best){best=d;target=p}}
      if(!target){e.targetId=undefined;continue}e.targetId=target.id;
      if(best>ENEMY_ATTACK_RANGE){e.x+=(target.x-e.x)/best*ENEMY_SPEED*dt;e.y+=(target.y-e.y)/best*ENEMY_SPEED*dt;this.enemyGrid.upsert(e);}
      else{const last=this.enemyAttackAt.get(e.id)??0;if(this.now-last>1200){this.enemyAttackAt.set(e.id,this.now);const damage=Math.max(1,Math.round(ENEMY_DAMAGE-target.stats.defense*.35));target.stats.hp=Math.max(0,target.stats.hp-damage);if(target.stats.hp<=0)this.respawnPlayer(target);}}
    }
  }
  private respawnPlayer(p:ServerPlayer){p.stats.hp=p.stats.maxHp;p.stats.mp=p.stats.maxMp;p.stats.stamina=p.stats.maxStamina;p.inputX=0;p.inputY=0;p.moving=false;p.x=WORLD_W/2;p.y=WORLD_H/2;this.playerGrid.upsert(p)}
  spawnGoblin(x:number,y:number){const id=randomUUID();const enemy:EnemyState={id,kind:'goblin',x,y,hp:50,maxHp:50,alive:true};this.enemies.set(id,enemy);this.enemyGrid.upsert(enemy);this.enemyAttackAt.delete(id);return id}
  seedDemoEnemies(){this.enemies.clear();this.enemyGrid.clear();this.enemyAttackAt.clear();for(const p of this.spawnPoints)this.spawnGoblin(p.x,p.y)}
  private respawnEnemies(){for(const e of [...this.enemies.values()])if(!e.alive){this.enemies.delete(e.id);this.enemyGrid.remove(e.id);this.enemyAttackAt.delete(e.id)}const alive=[...this.enemies.values()].filter(e=>e.alive).length;for(let i=alive;i<8;i++){const p=this.spawnPoints[Math.floor(Math.random()*this.spawnPoints.length)];this.spawnGoblin(p.x+(Math.random()*80-40),p.y+(Math.random()*80-40));}}

  useSkill(id:string,skillId:string,x:number,y:number){
    const p=this.players.get(id),skill=Object.hasOwn(SKILL_DEFS,skillId)?SKILL_DEFS[skillId]:undefined,weapon=p&&Object.hasOwn(WEAPON_DEFS,p.weaponId)?WEAPON_DEFS[p.weaponId]:undefined;
    if(!p||!skill)return{ok:false as const,msg:'Unknown skill.'};if(!weapon?.skills.includes(skillId))return{ok:false as const,msg:'Skill is not available for this weapon.'};
    if(p.stats.hp<=0)return{ok:false as const,msg:'You are dead.'};const now=this.now,cd=p.cooldowns.get(skillId)||0;if(now<cd)return{ok:false as const,msg:'Skill is on cooldown.'};
    if(p.stats.mp<skill.cost)return{ok:false as const,msg:'Not enough MP.'};if(skillId==='dash_strike'&&p.stats.stamina<20)return{ok:false as const,msg:'Not enough stamina.'};
    p.stats.mp-=skill.cost;if(skillId==='dash_strike')p.stats.stamina-=20;p.cooldowns.set(skillId,now+skill.cooldown);
    let dx=x,dy=y;if(Math.hypot(dx,dy)<.08){const dirs:Record<ServerPlayer['dir'],readonly [number,number]>={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};[dx,dy]=dirs[p.dir]}const len=Math.hypot(dx,dy)||1;dx/=len;dy/=len;
    const aoeCenter=skillId==='spin_slash'?{x:p.x,y:p.y}:{x:p.x+dx*skill.range,y:p.y+dy*skill.range};let hits=0;
    const queryRadius=skill.range+Math.max(skill.aoe,0)+16;
    for(const e of this.enemyGrid.query(p.x,p.y,queryRadius)){
      if(!e.alive)continue;const ex=e.x-p.x,ey=e.y-p.y,d=Math.hypot(ex,ey);if(skill.aoe<=0&&d>skill.range)continue;
      let affected=false;if(skill.aoe>0){affected=Math.hypot(e.x-aoeCenter.x,e.y-aoeCenter.y)<=skill.aoe&&(skillId==='spin_slash'||Math.hypot(aoeCenter.x-p.x,aoeCenter.y-p.y)<=skill.range);}else{const dot=(ex*dx+ey*dy)/(d||1);affected=dot>.25;}
      if(affected){const dmg=Math.max(1,Math.round((p.stats.attack+weapon.attack)*skill.power));e.hp-=dmg;hits++;if(e.hp<=0){e.hp=0;e.alive=false;this.enemyGrid.remove(e.id);this.killEnemy(p,e);}}
    }
    if(skillId==='dash_strike'){p.x=Math.max(PLAYER_MARGIN,Math.min(WORLD_W-PLAYER_MARGIN,p.x+dx*120));p.y=Math.max(PLAYER_MARGIN,Math.min(WORLD_H-PLAYER_MARGIN,p.y+dy*120));this.playerGrid.upsert(p)}
    return{ok:true as const,hits};
  }

  private addExp(p:ServerPlayer,amount:number){p.stats.exp+=amount;while(p.stats.exp>=p.stats.expToNext){p.stats.exp-=p.stats.expToNext;p.stats.level++;p.stats.expToNext=this.expForLevel(p.stats.level);p.stats.maxHp+=10;p.stats.hp=p.stats.maxHp;p.stats.maxMp+=5;p.stats.mp=p.stats.maxMp;p.stats.attack+=2;p.stats.defense+=1;}}
  private killEnemy(p:ServerPlayer,e:EnemyState){this.addExp(p,25);const uid=randomUUID();this.drops.set(uid,{id:uid,itemId:Math.random()<.65?'wood':'wheat',quantity:1,x:e.x,y:e.y});for(const q of p.quests){const def=Object.hasOwn(QUEST_DEFS,q.questId)?QUEST_DEFS[q.questId]:undefined;if(def?.kind==='kill'&&def.target===e.kind){q.progress=Math.min(def.amount,q.progress+1);q.completed=q.progress>=def.amount;}}}
  pickupDrop(playerId:string,dropId:string){const p=this.players.get(playerId),d=this.drops.get(dropId);if(!p||!d||p.stats.hp<=0||Math.hypot(p.x-d.x,p.y-d.y)>72)return false;if(!this.addItem(p,d.itemId,d.quantity))return false;this.drops.delete(dropId);this.updateCollectQuest(p,d.itemId,d.quantity);return true}
  private updateCollectQuest(p:ServerPlayer,itemId:string,amount:number){for(const q of p.quests){const def=Object.hasOwn(QUEST_DEFS,q.questId)?QUEST_DEFS[q.questId]:undefined;if(def?.kind==='collect'&&def.target===itemId){q.progress=Math.min(def.amount,q.progress+amount);q.completed=q.progress>=def.amount;}}}

  farmAction(id:string,action:'hoe'|'plant'|'water'|'harvest',x:number,y:number,seedId?:string){
    const p=this.players.get(id);if(!p||p.stats.hp<=0)return{ok:false as const,msg:'Invalid player.'};if(Math.hypot(x-p.x,y-p.y)>96)return{ok:false as const,msg:'Too far from your farm.'};
    const gx=Math.floor((x-FARM_ORIGIN.x)/FARM_TILE),gy=Math.floor((y-FARM_ORIGIN.y)/FARM_TILE);if(gx<0||gy<0||gx>=FARM_SIZE||gy>=FARM_SIZE)return{ok:false as const,msg:'Outside your farm.'};
    const ownerId=p.userId??id,key=this.farmKey(ownerId,gx,gy);const existing=[...this.crops.values()].find(c=>c.ownerId===ownerId&&Math.floor((c.x-FARM_ORIGIN.x)/FARM_TILE)===gx&&Math.floor((c.y-FARM_ORIGIN.y)/FARM_TILE)===gy);
    if(action==='hoe'){if(existing||this.tilled.has(key))return{ok:false as const,msg:'Tile already prepared.'};if(p.stats.stamina<5)return{ok:false as const,msg:'Not enough stamina.'};p.stats.stamina-=5;this.tilled.add(key);return{ok:true as const};}
    if(action==='plant'){if(existing||!this.tilled.has(key))return{ok:false as const,msg:'Hoe the tile first.'};if(!seedId||!Object.hasOwn(ITEM_DEFS,seedId)||ITEM_DEFS[seedId].type!=='seed')return{ok:false as const,msg:'Invalid seed.'};const item=p.inventory.find(i=>i.itemId===seedId);if(!item||item.quantity<1)return{ok:false as const,msg:'No seed.'};item.quantity--;this.compactInventory(p);const cropId=randomUUID();this.crops.set(cropId,{id:cropId,x:FARM_ORIGIN.x+gx*FARM_TILE+FARM_TILE/2,y:FARM_ORIGIN.y+gy*FARM_TILE+FARM_TILE/2,seedId,plantedAt:this.now,watered:false,ready:false,ownerId});return{ok:true as const};}
    if(!existing)return{ok:false as const,msg:'No crop.'};if(action==='water'){if(existing.watered)return{ok:false as const,msg:'Already watered.'};if(p.stats.stamina<2)return{ok:false as const,msg:'Not enough stamina.'};p.stats.stamina-=2;existing.watered=true;return{ok:true as const};}
    if(action==='harvest'){existing.ready=this.isCropReady(existing);if(!existing.watered||!existing.ready)return{ok:false as const,msg:'Not ready.'};const cropId=existing.seedId.replace('_seed','');if(!this.addItem(p,cropId,1))return{ok:false as const,msg:'Inventory full.'};this.crops.delete(existing.id);this.updateCollectQuest(p,cropId,1);this.tilled.add(key);return{ok:true as const};}
    return{ok:false as const,msg:'Unsupported farm action.'};
  }

  private compactInventory(p:ServerPlayer){p.inventory=p.inventory.filter(i=>Number.isFinite(i.quantity)&&i.quantity>0&&Object.hasOwn(ITEM_DEFS,i.itemId));}
  addItem(p:ServerPlayer,itemId:string,quantity:number){const def=Object.hasOwn(ITEM_DEFS,itemId)?ITEM_DEFS[itemId]:undefined;if(!def||quantity<1)return false;
    if(def.type==='weapon'&&(quantity!==1||p.inventory.some(i=>i.itemId===itemId&&i.quantity>0)))return false;
    let remaining=quantity;for(const i of p.inventory){if(i.itemId===itemId&&i.quantity<def.maxStack){const add=Math.min(def.maxStack-i.quantity,remaining);i.quantity+=add;remaining-=add;if(!remaining)return true;}}
    while(remaining>0){const add=Math.min(def.maxStack,remaining);p.inventory.push({uid:randomUUID(),itemId,quantity:add});remaining-=add;}return true;
  }
  buy(id:string,itemId:string,quantity:number){const p=this.players.get(id),def=Object.hasOwn(ITEM_DEFS,itemId)?ITEM_DEFS[itemId]:undefined;if(!p||!def||quantity<1||quantity>99||p.stats.hp<=0)return false;if(def.type==='weapon'&&(quantity!==1||p.inventory.some(i=>i.itemId===itemId&&i.quantity>0)))return false;const cost=def.price*quantity;if(p.gold<cost)return false;if(!this.addItem(p,itemId,quantity))return false;p.gold-=cost;return true}
  sell(id:string,itemId:string,quantity:number){const p=this.players.get(id),def=Object.hasOwn(ITEM_DEFS,itemId)?ITEM_DEFS[itemId]:undefined;if(!p||!def||p.stats.hp<=0||quantity<1||quantity>99)return false;if(p.weaponId===itemId)return false;const stacks=p.inventory.filter(i=>i.itemId===itemId),available=stacks.reduce((sum,i)=>sum+i.quantity,0);if(available<quantity)return false;let remaining=quantity;for(const stack of stacks){const take=Math.min(stack.quantity,remaining);stack.quantity-=take;remaining-=take;if(remaining===0)break;}p.gold+=Math.floor(def.price*.6)*quantity;this.compactInventory(p);return true}
  equip(id:string,itemId:string){const p=this.players.get(id);if(!p)return false;this.compactInventory(p);const i=p.inventory.find(x=>x.itemId===itemId),weapon=Object.hasOwn(WEAPON_DEFS,itemId)?WEAPON_DEFS[itemId]:undefined;if(!i||!weapon)return false;p.weaponId=itemId;return true}
  deliverQuest(id:string,questId:string){const p=this.players.get(id),q=p?.quests.find(q=>q.questId===questId),def=Object.hasOwn(QUEST_DEFS,questId)?QUEST_DEFS[questId]:undefined;if(!p||!q||!def||def.kind!=='deliver'||q.claimed)return false;if(q.completed)return true;const item=p.inventory.find(i=>i.itemId===def.target);if(!item||item.quantity<def.amount)return false;item.quantity-=def.amount;this.compactInventory(p);q.progress=def.amount;q.completed=true;return true}
  claimQuest(id:string,questId:string){const p=this.players.get(id),q=p?.quests.find(q=>q.questId===questId),def=Object.hasOwn(QUEST_DEFS,questId)?QUEST_DEFS[questId]:undefined;if(!p||!q||!def||!q.completed||q.claimed)return false;q.claimed=true;p.gold+=def.reward;this.addExp(p,def.exp);return true}
  cleanupDrops(){if(this.drops.size>1000){const oldest=[...this.drops.keys()].slice(0,this.drops.size-1000);for(const id of oldest)this.drops.delete(id)}}

  async persistAll(){for(const id of [...this.players.keys()])await this.persistPlayer(id)}
  async persistPlayer(id:string){
    const p=this.players.get(id);if(!p?.userId)return;const uid=p.userId;const previous=this.persistLocks.get(uid)??Promise.resolve();let release!:()=>void;const current=new Promise<void>(r=>{release=r});const chain=previous.then(()=>current);this.persistLocks.set(uid,chain);await previous;
    try{this.compactInventory(p);const prefix=`${uid}:`;const farmTiles=[...this.tilled].filter(k=>k.startsWith(prefix));const crops=[...this.crops.values()].filter(c=>c.ownerId===uid).map(({ready,...crop})=>crop);await Character.findOneAndUpdate({userId:uid},{x:p.x,y:p.y,level:p.stats.level,exp:p.stats.exp,hp:p.stats.hp,maxHp:p.stats.maxHp,mp:p.stats.mp,maxMp:p.stats.maxMp,stamina:p.stats.stamina,maxStamina:p.stats.maxStamina,attack:p.stats.attack,defense:p.stats.defense,moveSpeed:p.stats.moveSpeed,weaponId:p.weaponId,gold:p.gold,inventory:p.inventory,quests:p.quests,farmTiles,crops},{upsert:true,setDefaultsOnInsert:true,runValidators:true,new:true});}
    catch(error){logger.error(`persistPlayer(${id}) failed`,{error:String(error)})}finally{release();if(this.persistLocks.get(uid)===chain)this.persistLocks.delete(uid)}
  }

  snapshotForPlayer(id:string):WorldSnapshot{
    const viewer=this.players.get(id);if(!viewer)return{serverTime:this.now,players:[],enemies:[],crops:[],drops:[],farmTiles:[]};
    const radius=AOI_RADIUS;const inRange=(x:number,y:number)=>Math.hypot(x-viewer.x,y-viewer.y)<=radius;
    const players=this.playerGrid.query(viewer.x,viewer.y,radius).filter(p=>p.id===id||!!p.socketId).map(p=>p.id===id?this.publicPlayer(p):this.publicRemotePlayer(p));
    const enemies=this.enemyGrid.query(viewer.x,viewer.y,radius).filter(e=>e.alive);
    const drops=[...this.drops.values()].filter(d=>inRange(d.x,d.y));
    // Farms are instanced/private: only the owner's farm layer is sent to that owner.
    const crops=[...this.crops.values()].filter(c=>c.ownerId===viewer.userId).map(c=>({...c,ready:this.isCropReady(c)}));
    const farmTiles=[...this.tilled].filter(key=>this.parseFarmKey(key)?.ownerId===viewer.userId);
    return{serverTime:this.now,players,enemies,crops,drops,farmTiles};
  }

  snapshot():WorldSnapshot{return this.snapshotForPlayer([...this.players.keys()][0]??'')}
  publicPlayer(p:ServerPlayer):PlayerState{return{id:p.id,name:p.name,x:p.x,y:p.y,dir:p.dir,moving:p.moving,stats:{...p.stats},weaponId:p.weaponId,lastProcessedInputSeq:p.lastProcessedInputSeq}}
  publicRemotePlayer(p:ServerPlayer):RemotePlayerState{return{id:p.id,name:p.name,x:p.x,y:p.y,dir:p.dir,moving:p.moving,weaponId:p.weaponId}}
  characterSnapshot(id:string):CharacterSnapshot|undefined{const p=this.players.get(id);if(!p)return;return{player:this.publicPlayer(p),inventory:p.inventory.map(i=>({...i})),quests:p.quests.map(q=>({...q})),gold:p.gold}}
}
