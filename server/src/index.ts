import http from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { z } from 'zod';
import mongoose from 'mongoose';
import { PORT,TICK_RATE,SNAPSHOT_RATE,CLIENT_ORIGINS,MONGO_URI,JWT_SECRET,TRUST_PROXY } from './config/constants.js';
import { World } from './game/World.js';
import { registerSocketHandlers } from './network/socket.js';
import { connectDB,isDBConnected } from './db.js';
import { hashPassword,signToken,verifyPassword } from './auth.js';
import { User,Character } from './models.js';
import { QUEST_DEFS, MOVE_SPEED } from '@farm-dungeon/shared';
import { logger } from './logger.js';

if(!MONGO_URI) throw new Error('MONGO_URI is required. Create server/.env or root .env with MONGO_URI.');
if(!JWT_SECRET || JWT_SECRET.length<32) throw new Error('JWT_SECRET must be set to at least 32 characters.');

const app=express();
app.set('trust proxy',TRUST_PROXY);
const corsOptions={origin:CLIENT_ORIGINS,credentials:true};
app.use(cors(corsOptions));app.use(express.json({limit:'32kb'}));

type Bucket={count:number;reset:number};const buckets=new Map<string,Bucket>();
setInterval(()=>{const now=Date.now();for(const [key,b] of buckets)if(now>=b.reset)buckets.delete(key)},60_000).unref();
function rateLimit(key:string,max:number,windowMs:number){const now=Date.now();const b=buckets.get(key);if(!b||now>=b.reset){buckets.set(key,{count:1,reset:now+windowMs});return true}if(++b.count>max)return false;return true}
const publicRate=(req:express.Request)=>`${req.ip}:${req.path}`;

app.get('/health',(_req,res)=>res.json({ok:true,database:isDBConnected()}));
const registerSchema=z.object({email:z.email().trim().max(120),password:z.string().min(6).max(100),name:z.string().trim().min(2).max(20).regex(/^[\p{L}\p{N}_ -]+$/u)});
const loginSchema=z.object({email:z.email().trim().max(120),password:z.string().min(1).max(100)});

app.post('/api/auth/register',async(req,res):Promise<void>=>{
  if(!rateLimit(publicRate(req),5,60_000)){res.status(429).json({error:'Too many requests'});return}
  const parsed=registerSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Invalid registration data'});return}
  let createdUserId:string|undefined;
  try{
    await connectDB();const email=parsed.data.email.toLowerCase();
    const exists=await User.findOne({email}).lean();if(exists){res.status(400).json({error:'Registration failed'});return}
    const user=await User.create({email,passwordHash:await hashPassword(parsed.data.password),name:parsed.data.name});createdUserId=String(user._id);
    const character=await Character.create({userId:user._id,name:parsed.data.name,x:1200,y:800,level:1,exp:0,hp:100,maxHp:100,mp:60,maxMp:60,stamina:100,maxStamina:100,attack:10,defense:5,moveSpeed:MOVE_SPEED,weaponId:'iron_sword',gold:250,inventory:[{uid:randomUUID(),itemId:'wheat_seed',quantity:5},{uid:randomUUID(),itemId:'iron_sword',quantity:1}],quests:Object.keys(QUEST_DEFS).map(questId=>({questId,progress:0,completed:false,claimed:false})),farmTiles:[],crops:[]});
    res.status(201).json({token:signToken(createdUserId),characterId:String(character._id),name:parsed.data.name});
  }catch(error){
    if(createdUserId){try{await User.deleteOne({_id:createdUserId})}catch(cleanupError){logger.error('register rollback failed',{error:String(cleanupError),userId:createdUserId})}}
    logger.error('register failed',{error:String(error)});res.status(500).json({error:'Registration failed'});
  }
});

app.post('/api/auth/login',async(req,res):Promise<void>=>{
  if(!rateLimit(publicRate(req),10,60_000)){res.status(429).json({error:'Too many requests'});return}
  const parsed=loginSchema.safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Invalid credentials'});return}
  try{await connectDB();const user=await User.findOne({email:parsed.data.email.toLowerCase()});const DUMMY_HASH='$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';const passwordOk=await verifyPassword(parsed.data.password,user?.passwordHash??DUMMY_HASH);if(!user||!passwordOk){res.status(401).json({error:'Invalid email or password'});return}const character=await Character.findOne({userId:user._id}).lean();if(!character){res.status(500).json({error:'Character data unavailable'});return}res.json({token:signToken(String(user._id)),characterId:String(character._id),name:user.name});}
  catch(error){logger.error('login failed',{error:String(error)});res.status(500).json({error:'Login service unavailable'})}
});

const httpServer=http.createServer(app);const io=new Server(httpServer,{cors:corsOptions,perMessageDeflate:{threshold:1024}});const world=new World();registerSocketHandlers(io,world);
if(!(await connectDB()))throw new Error('Database connection is required.');
world.seedDemoEnemies();

const fixedDt=1/TICK_RATE;let accumulator=0;let snapshotAccumulator=0;let lastTime=performance.now();
const loop=setInterval(()=>{
  const now=performance.now();const elapsed=Math.min(.25,Math.max(0,(now-lastTime)/1000));lastTime=now;accumulator+=elapsed;let steps=0;
  while(accumulator>=fixedDt&&steps<5){world.tick(fixedDt);accumulator-=fixedDt;steps++}
  // Avoid a spiral of death after a long event-loop stall. The next iteration resumes from a bounded accumulator.
  if(steps===5&&accumulator>=fixedDt)accumulator=fixedDt;
  snapshotAccumulator+=elapsed;
  if(snapshotAccumulator>=1/SNAPSHOT_RATE){snapshotAccumulator%=1/SNAPSHOT_RATE;for(const s of io.sockets.sockets.values()){if(!s.data.authenticated)continue;const snapshot=world.snapshotForPlayer(s.id);s.emit('world:snapshot',snapshot);const character=world.characterSnapshot(s.id);if(character)s.emit('character:state',character)}}
},5);loop.unref();
setInterval(()=>{void world.persistAll()},30_000).unref();

const shutdown=async()=>{logger.info('Shutting down');await world.persistAll();io.close();await mongoose.disconnect();await new Promise<void>(resolve=>{const timer=setTimeout(resolve,3000);httpServer.close(()=>{clearTimeout(timer);resolve()})});process.exit(0)};
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
httpServer.listen(PORT,()=>logger.info(`Server listening on ${PORT}`));
