import bcrypt from 'bcryptjs'; import jwt from 'jsonwebtoken'; import {JWT_SECRET} from './config/constants.js';
export async function hashPassword(p:string){return bcrypt.hash(p,12)}
export async function verifyPassword(p:string,h:string){return bcrypt.compare(p,h)}
export function signToken(userId:string){return jwt.sign({sub:userId},JWT_SECRET,{expiresIn:'7d'})}
export function verifyToken(token:string){return jwt.verify(token,JWT_SECRET) as {sub:string}}
