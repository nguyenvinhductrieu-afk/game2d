import Phaser from 'phaser';
import type { RemotePlayerState } from '@farm-dungeon/shared';
import { WORLD_H, WORLD_W } from '../config/constants.js';

type Sample={t:number;x:number;y:number;dir:RemotePlayerState['dir'];moving:boolean};

export class RemotePlayer{
  readonly sprite:Phaser.Physics.Arcade.Sprite;
  private samples:Sample[]=[];
  private readonly interpolationDelay=100;
  private readonly maxSamples=8;
  constructor(scene:Phaser.Scene,state:RemotePlayerState,serverTime=performance.now()){
    // MainScene owns the physics bounds, but keeping this defensive call makes the entity safe when reused by another scene.
    scene.physics.world.setBounds(0,0,WORLD_W,WORLD_H);
    this.sprite=scene.physics.add.sprite(state.x,state.y,'player');
    this.sprite.setCollideWorldBounds(true).setBodySize(18,18).setOffset(7,13).setDepth(10);
    this.push(state,serverTime,true);
  }
  push(state:RemotePlayerState,serverTime:number,snap=false){const last=this.samples[this.samples.length-1];if(last&&serverTime<last.t)return;this.samples.push({t:serverTime,x:state.x,y:state.y,dir:state.dir,moving:state.moving});if(this.samples.length>this.maxSamples)this.samples.shift();if(snap)this.sprite.setPosition(state.x,state.y);this.sprite.setFlipX(state.dir==='left')}
  update(renderServerTime:number){if(!this.samples.length)return;const targetT=renderServerTime-this.interpolationDelay;while(this.samples.length>=2&&this.samples[1].t<=targetT)this.samples.shift();const a=this.samples[0],b=this.samples[1];if(!b){this.sprite.x=Phaser.Math.Linear(this.sprite.x,a.x,.18);this.sprite.y=Phaser.Math.Linear(this.sprite.y,a.y,.18);this.sprite.setFlipX(a.dir==='left');return}const alpha=Phaser.Math.Clamp((targetT-a.t)/(b.t-a.t),0,1);this.sprite.x=Phaser.Math.Linear(a.x,b.x,alpha);this.sprite.y=Phaser.Math.Linear(a.y,b.y,alpha);this.sprite.setFlipX((alpha<.5?a.dir:b.dir)==='left');this.sprite.anims.play((alpha<.5?a.moving:b.moving)?'walk':'idle',true)}
  destroy(){this.samples.length=0;this.sprite.destroy()}
}
