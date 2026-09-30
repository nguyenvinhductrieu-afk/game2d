import mongoose from 'mongoose';
import { MONGO_URI } from './config/constants.js';

let connected=false;
let connecting:Promise<boolean>|undefined;
mongoose.connection.on('connected',()=>{connected=true});
mongoose.connection.on('disconnected',()=>{connected=false});
mongoose.connection.on('error',()=>{connected=false});

export async function connectDB(){
  if(mongoose.connection.readyState===1){connected=true;return true}
  if(!MONGO_URI)return false;
  if(connecting)return connecting;
  connecting=(async()=>{
    try{await mongoose.connect(MONGO_URI,{serverSelectionTimeoutMS:5000,maxPoolSize:20,minPoolSize:2});connected=true;console.log('MongoDB connected');return true}
    catch(error){connected=false;console.error('MongoDB connection failed',error);return false}
    finally{connecting=undefined}
  })();
  return connecting;
}
export function isDBConnected(){return connected&&mongoose.connection.readyState===1}
