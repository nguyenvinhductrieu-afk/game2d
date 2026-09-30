import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { AOI_RADIUS, type ClientToServerEvents, type ServerToClientEvents } from '@farm-dungeon/shared';
import { World } from '../game/World.js';
import { verifyToken } from '../auth.js';
import { Character, User } from '../models.js';

const inputSchema=z.object({seq:z.number().int().nonnegative(),x:z.number().finite().min(-1).max(1),y:z.number().finite().min(-1).max(1)});
const skillSchema=z.object({skillId:z.string().min(1).max(40),x:z.number().finite().min(-1).max(1),y:z.number().finite().min(-1).max(1)});
const farmSchema=z.object({action:z.enum(['hoe','plant','water','harvest']),x:z.number().finite(),y:z.number().finite(),seedId:z.string().max(40).optional()});
const itemSchema=z.object({itemId:z.string().min(1).max(40)});
const tradeSchema=z.object({itemId:z.string().min(1).max(40),quantity:z.number().int().positive().max(99)});
const questSchema=z.object({questId:z.string().min(1).max(60)});
const dropSchema=z.object({dropId:z.uuid()});
const chatSchema=z.object({channel:z.enum(['world','party','private']),text:z.string().trim().min(1).max(200),to:z.string().max(64).optional()});
const authLocks=new Map<string,Promise<void>>();

export function registerSocketHandlers(io:Server<ClientToServerEvents,ServerToClientEvents>,world:World){
  io.on('connection',socket=>{
    socket.data.authenticated=false;let playerId:string|undefined;let intentional=false;let disconnected=false;

    socket.once('disconnect',()=>{
      disconnected=true;
      if(intentional||!playerId)return;
      const p=world.getPlayer(playerId);if(p?.socketId===socket.id){void world.persistPlayer(playerId);world.detachPlayer(playerId)}
    });

    void authenticate(socket).then(id=>{playerId=id;}).catch(()=>{
      intentional=true;
      if(!socket.connected) return;
      socket.disconnect(true);
    });

    async function authenticate(s:Socket<ClientToServerEvents,ServerToClientEvents>):Promise<string>{
      const token=typeof s.handshake.auth?.token==='string'?s.handshake.auth.token:'';if(!token)throw new Error('auth');
      const claims=verifyToken(token);const uid=String(claims.sub);const previousLock=authLocks.get(uid)??Promise.resolve();let release!:()=>void;const current=new Promise<void>(r=>{release=r});const chain=previousLock.then(()=>current);authLocks.set(uid,chain);await previousLock;
      try{
        const [user,character]=await Promise.all([User.findById(uid).lean(),Character.findOne({userId:uid}).lean()]);
        if(disconnected||!s.connected)throw new Error('disconnected');if(!user||!character)throw new Error('character');
        const previous=world.getPlayerByUserId(uid);const oldSocketId=previous?.socketId;let p=previous?world.attachPlayer(uid,s.id):undefined;
        if(!p){
          p=world.addPlayer(s.id,character.name,{x:character.x,y:character.y,weaponId:character.weaponId,gold:character.gold,inventory:character.inventory.map(i=>({...i})),quests:character.quests.map(q=>({...q})),stats:{level:character.level,exp:character.exp,expToNext:world.expForLevel(character.level),hp:character.hp,maxHp:character.maxHp,mp:character.mp,maxMp:character.maxMp,stamina:character.stamina,maxStamina:character.maxStamina,attack:character.attack,defense:character.defense,moveSpeed:character.moveSpeed}},uid);
          world.restoreFarm(uid,character.farmTiles??[],character.crops??[]);
        }
        // Close a stale owner only after the new player object is ready. If this socket died during the async auth window, undo immediately.
        if(disconnected||!s.connected){
          // The previous socket may still be alive. Restore ownership to it instead of deleting the grace-session.
          if(oldSocketId&&io.sockets.sockets.has(oldSocketId)){world.attachPlayer(uid,oldSocketId)}else{world.removePlayer(s.id)}
          throw new Error('disconnected')
        }
        if(oldSocketId&&oldSocketId!==s.id){const oldSocket=io.sockets.sockets.get(oldSocketId);if(oldSocket){oldSocket.data.authenticated=false;oldSocket.disconnect(true)}}
        p.socketId=s.id;s.data.authenticated=true;s.emit('system:message',`Welcome, ${character.name}!`);s.emit('character:state',world.characterSnapshot(s.id)!);

        const lastEvent=new Map<string,number>();const allow=(name:string,ms:number)=>{const now=Date.now(),last=lastEvent.get(name)??0;if(now-last<ms)return false;lastEvent.set(name,now);return true};
        s.on('player:input',payload=>{if(!allow('input',20))return;const r=inputSchema.safeParse(payload);if(r.success)world.applyInput(s.id,r.data)});
        s.on('skill:use',payload=>{if(!allow('skill',50))return;const r=skillSchema.safeParse(payload);if(!r.success)return s.emit('system:message','Invalid skill request.');const result=world.useSkill(s.id,r.data.skillId,r.data.x,r.data.y);if(!result.ok)return s.emit('system:message',result.msg);const p2=world.getPlayer(s.id);if(!p2)return;const fx={kind:r.data.skillId,x:p2.x,y:p2.y,amount:result.hits};for(const near of world.playersNear(fx.x,fx.y,AOI_RADIUS)){const target=io.sockets.sockets.get(near.id);if(target?.data.authenticated)target.emit('combat:fx',fx)}});
        s.on('farm:action',payload=>{if(!allow('farm',150))return;const r=farmSchema.safeParse(payload);if(!r.success)return s.emit('system:message','Invalid farming request.');const result=world.farmAction(s.id,r.data.action,r.data.x,r.data.y,r.data.seedId);if(!result.ok)s.emit('system:message',result.msg);const state=world.characterSnapshot(s.id);if(state)s.emit('character:state',state)});
        s.on('inventory:equip',payload=>{const r=itemSchema.safeParse(payload);if(!r.success)return s.emit('system:message','Invalid equipment request.');if(!world.equip(s.id,r.data.itemId))s.emit('system:message','Cannot equip that item.');const state=world.characterSnapshot(s.id);if(state)s.emit('character:state',state)});
        s.on('shop:buy',payload=>{const r=tradeSchema.safeParse(payload);if(!r.success)return s.emit('system:message','Invalid purchase request.');if(!world.buy(s.id,r.data.itemId,r.data.quantity))s.emit('system:message','Purchase rejected.');const state=world.characterSnapshot(s.id);if(state)s.emit('character:state',state)});
        s.on('shop:sell',payload=>{const r=tradeSchema.safeParse(payload);if(!r.success)return s.emit('system:message','Invalid sale request.');if(!world.sell(s.id,r.data.itemId,r.data.quantity))s.emit('system:message','Sale rejected.');const state=world.characterSnapshot(s.id);if(state)s.emit('character:state',state)});
        s.on('quest:deliver',payload=>{const r=questSchema.safeParse(payload);if(!r.success)return s.emit('system:message','Invalid delivery request.');if(!world.deliverQuest(s.id,r.data.questId))s.emit('system:message','Delivery rejected.');const state=world.characterSnapshot(s.id);if(state)s.emit('character:state',state)});
        s.on('quest:claim',payload=>{const r=questSchema.safeParse(payload);if(!r.success)return s.emit('system:message','Invalid quest request.');if(!world.claimQuest(s.id,r.data.questId))s.emit('system:message','Quest cannot be claimed.');const state=world.characterSnapshot(s.id);if(state)s.emit('character:state',state)});
        s.on('drop:pickup',payload=>{const r=dropSchema.safeParse(payload);if(!r.success)return s.emit('system:message','Invalid pickup request.');if(!world.pickupDrop(s.id,r.data.dropId))s.emit('system:message','Cannot pick up that item.');const state=world.characterSnapshot(s.id);if(state)s.emit('character:state',state)});
        s.on('chat:send',payload=>{if(!allow('chat',500))return s.emit('system:message','Please slow down.');const r=chatSchema.safeParse(payload);if(!r.success)return s.emit('system:message','Invalid chat message.');const player=world.getPlayer(s.id);if(!player)return;if(r.data.channel!=='world')return s.emit('system:message','Only world chat is enabled.');const msg={channel:'world',from:player.name,text:r.data.text,ts:Date.now()};for(const target of world.playersNear(player.x,player.y,AOI_RADIUS)){const targetSocket=io.sockets.sockets.get(target.id);if(targetSocket?.data.authenticated)targetSocket.emit('chat:message',msg)}});
        return s.id;
      }finally{release();if(authLocks.get(uid)===chain)authLocks.delete(uid)}
    }
  });
}
