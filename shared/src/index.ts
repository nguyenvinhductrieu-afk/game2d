export type Direction = 'up' | 'down' | 'left' | 'right';
export type ItemType = 'seed' | 'crop' | 'weapon' | 'material' | 'consumable';
export type WeaponType = 'sword' | 'bow' | 'staff';

export const WORLD_W = 2400;
export const WORLD_H = 1600;
export const WORLD_PLAYER_MARGIN = 16;
export const MOVE_SPEED = 180;
export const FARM_TILE = 48;
export const FARM_ORIGIN = { x: 300, y: 250 } as const;
export const FARM_SIZE = 20;
export const AOI_RADIUS = 1100;
export const CROP_GROWTH_MS = 60_000;

export interface InputState { seq: number; x: number; y: number; }
export interface Stats { level:number; exp:number; expToNext:number; hp:number; maxHp:number; mp:number; maxMp:number; stamina:number; maxStamina:number; attack:number; defense:number; moveSpeed:number; }

/** Full player state is only sent for the local player. */
export interface PlayerState {
  id:string; name:string; x:number; y:number; dir:Direction; moving:boolean; stats:Stats; weaponId:string;
  lastProcessedInputSeq:number;
}

/** Remote players never receive combat/economy stats. */
export interface RemotePlayerState {
  id:string; name:string; x:number; y:number; dir:Direction; moving:boolean; weaponId:string;
}

export interface InventoryItem { uid:string; itemId:string; quantity:number; }
export interface CropState { id:string; x:number; y:number; seedId:string; plantedAt:number; watered:boolean; ready:boolean; ownerId:string; }
export interface EnemyState { id:string; kind:string; x:number; y:number; hp:number; maxHp:number; targetId?:string; alive:boolean; }
export interface DropState { id:string; itemId:string; quantity:number; x:number; y:number; }
export interface QuestProgress { questId:string; progress:number; completed:boolean; claimed:boolean; }
export interface CharacterSnapshot { player:PlayerState; inventory:InventoryItem[]; quests:QuestProgress[]; gold:number; }
export interface WorldSnapshot { serverTime:number; players:Array<PlayerState|RemotePlayerState>; enemies:EnemyState[]; crops:CropState[]; drops:DropState[]; farmTiles:string[]; }

export const ITEM_DEFS: Record<string,{name:string;type:ItemType;maxStack:number;price:number;icon:string}> = {
  wheat_seed:{name:'Wheat Seed',type:'seed',maxStack:99,price:5,icon:'🌱'}, carrot_seed:{name:'Carrot Seed',type:'seed',maxStack:99,price:8,icon:'🥕'},
  wheat:{name:'Wheat',type:'crop',maxStack:99,price:12,icon:'🌾'}, carrot:{name:'Carrot',type:'crop',maxStack:99,price:18,icon:'🥕'},
  wood:{name:'Wood',type:'material',maxStack:99,price:3,icon:'🪵'}, iron_sword:{name:'Iron Sword',type:'weapon',maxStack:1,price:100,icon:'⚔️'},
  oak_bow:{name:'Oak Bow',type:'weapon',maxStack:1,price:120,icon:'🏹'}, fire_staff:{name:'Fire Staff',type:'weapon',maxStack:1,price:180,icon:'🔥'},
};
export const WEAPON_DEFS: Record<string,{name:string;type:WeaponType;attack:number;skills:string[]}> = {
  iron_sword:{name:'Iron Sword',type:'sword',attack:12,skills:['slash','spin_slash','dash_strike']}, oak_bow:{name:'Oak Bow',type:'bow',attack:10,skills:['arrow','multi_shot','rain_arrows']}, fire_staff:{name:'Fire Staff',type:'staff',attack:14,skills:['fire_bolt','fireball','meteor']},
};
export const SKILL_DEFS: Record<string,{name:string;cost:number;cooldown:number;range:number;power:number;aoe:number}> = {
  slash:{name:'Slash',cost:0,cooldown:350,range:52,power:1.4,aoe:0}, spin_slash:{name:'Spin Slash',cost:12,cooldown:1800,range:78,power:1.8,aoe:70}, dash_strike:{name:'Dash Strike',cost:18,cooldown:2200,range:90,power:2.0,aoe:35},
  arrow:{name:'Arrow',cost:0,cooldown:450,range:220,power:1.2,aoe:0}, multi_shot:{name:'Multi Shot',cost:14,cooldown:1800,range:210,power:1.3,aoe:90}, rain_arrows:{name:'Rain Arrows',cost:22,cooldown:3500,range:230,power:2.0,aoe:120},
  fire_bolt:{name:'Fire Bolt',cost:0,cooldown:500,range:180,power:1.4,aoe:0}, fireball:{name:'Fireball',cost:16,cooldown:2000,range:180,power:2.2,aoe:75}, meteor:{name:'Meteor',cost:30,cooldown:4500,range:240,power:3.0,aoe:130},
};
export const QUEST_DEFS: Record<string,{name:string;kind:'kill'|'collect'|'deliver';target:string;amount:number;reward:number;exp:number}> = {
  first_goblins:{name:'Clear the Goblins',kind:'kill',target:'goblin',amount:5,reward:80,exp:120}, wheat_harvest:{name:'Harvest Wheat',kind:'collect',target:'wheat',amount:5,reward:60,exp:80}, carrot_delivery:{name:'Carrot Delivery',kind:'deliver',target:'carrot',amount:3,reward:100,exp:100},
};

export interface ServerToClientEvents {
  'world:snapshot': (snapshot:WorldSnapshot)=>void;
  'character:state': (snapshot:CharacterSnapshot)=>void;
  'chat:message': (message:{channel:string;from:string;text:string;ts:number})=>void;
  'system:message': (message:string)=>void;
  'combat:fx': (fx:{kind:string;x:number;y:number;amount?:number})=>void;
}
export interface ClientToServerEvents {
  'player:input': (input:InputState)=>void;
  'skill:use': (payload:{skillId:string;x:number;y:number})=>void;
  'farm:action': (payload:{action:'hoe'|'plant'|'water'|'harvest';x:number;y:number;seedId?:string})=>void;
  'inventory:equip': (payload:{itemId:string})=>void;
  'shop:buy': (payload:{itemId:string;quantity:number})=>void;
  'shop:sell': (payload:{itemId:string;quantity:number})=>void;
  'quest:claim': (payload:{questId:string})=>void;
  'quest:deliver': (payload:{questId:string})=>void;
  'chat:send': (payload:{channel:'world'|'party'|'private';text:string;to?:string})=>void;
  'drop:pickup': (payload:{dropId:string})=>void;
}
