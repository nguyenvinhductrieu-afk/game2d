import mongoose, { Schema, type HydratedDocument, type Model } from 'mongoose';

export interface IUser { email:string; passwordHash:string; name:string; createdAt?:Date; }
export interface IInventoryItem { uid:string; itemId:string; quantity:number; }
export interface IQuestProgress { questId:string; progress:number; completed:boolean; claimed:boolean; }
export interface ISavedCrop { id:string; x:number; y:number; seedId:string; plantedAt:number; watered:boolean; ownerId:string; }
export interface ICharacter {
  userId: mongoose.Types.ObjectId; name:string; x:number; y:number; level:number; exp:number;
  hp:number; maxHp:number; mp:number; maxMp:number; stamina:number; maxStamina:number;
  attack:number; defense:number; moveSpeed:number; weaponId:string; gold:number;
  inventory:IInventoryItem[]; quests:IQuestProgress[]; farmTiles:string[]; crops:ISavedCrop[];
}

const ItemSchema = new Schema<IInventoryItem>({uid:{type:String,required:true},itemId:{type:String,required:true},quantity:{type:Number,required:true,min:1}},{_id:false});
const QuestSchema = new Schema<IQuestProgress>({questId:{type:String,required:true},progress:{type:Number,required:true,default:0},completed:{type:Boolean,required:true,default:false},claimed:{type:Boolean,required:true,default:false}},{_id:false});
const CropSchema = new Schema<ISavedCrop>({id:{type:String,required:true},x:{type:Number,required:true},y:{type:Number,required:true},seedId:{type:String,required:true},plantedAt:{type:Number,required:true},watered:{type:Boolean,required:true},ownerId:{type:String,required:true}},{_id:false});
const UserSchema = new Schema<IUser>({email:{type:String,unique:true,index:true,required:true},passwordHash:{type:String,required:true},name:{type:String,required:true},createdAt:{type:Date,default:Date.now}});
const CharacterSchema = new Schema<ICharacter>({
  userId:{type:Schema.Types.ObjectId,unique:true,index:true,required:true}, name:{type:String,required:true},
  x:{type:Number,default:1200},y:{type:Number,default:800},level:{type:Number,default:1},exp:{type:Number,default:0},
  hp:{type:Number,default:100},maxHp:{type:Number,default:100},mp:{type:Number,default:60},maxMp:{type:Number,default:60},
  stamina:{type:Number,default:100},maxStamina:{type:Number,default:100},attack:{type:Number,default:10},defense:{type:Number,default:5},
  moveSpeed:{type:Number,default:180},weaponId:{type:String,default:'iron_sword'},gold:{type:Number,default:250},
  inventory:{type:[ItemSchema],default:[]},quests:{type:[QuestSchema],default:[]},farmTiles:{type:[String],default:[]},crops:{type:[CropSchema],default:[]}
},{timestamps:true});
CharacterSchema.index({userId:1},{unique:true});

export const User: Model<IUser> = (mongoose.models.User as Model<IUser> | undefined) ?? mongoose.model<IUser>('User',UserSchema);
export const Character: Model<ICharacter> = (mongoose.models.Character as Model<ICharacter> | undefined) ?? mongoose.model<ICharacter>('Character',CharacterSchema);
export type UserDocument = HydratedDocument<IUser>;
export type CharacterDocument = HydratedDocument<ICharacter>;
