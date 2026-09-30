import Phaser from 'phaser';
import type { WorldSnapshot,CharacterSnapshot,InputState } from '@farm-dungeon/shared';
import { ITEM_DEFS,WEAPON_DEFS,SKILL_DEFS, QUEST_DEFS } from '@farm-dungeon/shared';
import { FARM_ORIGIN,FARM_SIZE,FARM_TILE,MOVE_SPEED,WORLD_H,WORLD_W,WORLD_PLAYER_MARGIN } from '../config/constants.js';
import { VirtualJoystick } from '../input/VirtualJoystick.js';
import { SocketClient } from '../net/SocketClient.js';
import { RemotePlayer } from '../entities/RemotePlayer.js';

export class MainScene extends Phaser.Scene{
  socket!:SocketClient;joystick!:VirtualJoystick;player?:Phaser.Physics.Arcade.Sprite;
  others=new Map<string,RemotePlayer>();enemies=new Map<string,Phaser.GameObjects.Container>();drops=new Map<string,Phaser.GameObjects.Container>();crops=new Map<string,Phaser.GameObjects.Container>();farmTiles=new Map<string,Phaser.GameObjects.Rectangle>();
  keys!:Record<'W'|'A'|'S'|'D',Phaser.Input.Keyboard.Key>;seq=0;lastInputSent=0;state?:CharacterSnapshot;private pendingInputs:InputState[]=[];private latestServerTime=Date.now();private serverClockOffset=0;
  hud!:Phaser.GameObjects.Text;chat!:Phaser.GameObjects.Text;buttons:Phaser.GameObjects.Text[]=[];chatInput?:HTMLInputElement;
  private resizeHandler=()=>this.layoutButtons();private failureCount=0;private shuttingDown=false;private questPanel?:Phaser.GameObjects.Container;private chatLines:string[]=[];
  constructor(){super('MainScene')}
  preload(){this.load.spritesheet('player','/assets/player-sheet.png',{frameWidth:32,frameHeight:32})}
  create(){
    this.cameras.main.setBackgroundColor('#6da66f');this.add.grid(WORLD_W/2,WORLD_H/2,WORLD_W,WORLD_H,FARM_TILE,FARM_TILE,0x6da66f,0,0x56865a,.22);
    // Critical: Arcade physics defaults to 1280x720 unless explicitly changed.
    this.physics.world.setBounds(0,0,WORLD_W,WORLD_H);
    this.anims.create({key:'walk',frames:this.anims.generateFrameNumbers('player',{start:0,end:3}),frameRate:8,repeat:-1});this.anims.create({key:'idle',frames:[{key:'player',frame:0}],frameRate:1});
    const k=this.input.keyboard!;this.keys={W:k.addKey(Phaser.Input.Keyboard.KeyCodes.W,false),A:k.addKey(Phaser.Input.Keyboard.KeyCodes.A,false),S:k.addKey(Phaser.Input.Keyboard.KeyCodes.S,false),D:k.addKey(Phaser.Input.Keyboard.KeyCodes.D,false)};
    this.joystick=new VirtualJoystick(this);this.socket=new SocketClient();
    this.hud=this.add.text(16,16,'Connecting...',{fontSize:'16px',color:'#fff',backgroundColor:'#0008',padding:{x:8,y:6}}).setScrollFactor(0).setDepth(2000);
    this.chat=this.add.text(16,92,'',{fontSize:'13px',color:'#fff',backgroundColor:'#0008',padding:{x:8,y:5},wordWrap:{width:380},lineSpacing:2}).setScrollFactor(0).setDepth(2000);
    this.socket.on('world:snapshot',s=>this.renderWorld(s));
    this.socket.on('character:state',s=>{this.state=s;this.updateHud();this.refreshButtonLabels();if(this.questPanel?.visible)this.renderQuestPanel()});
    this.socket.on('chat:message',m=>this.appendChat(`${m.from}: ${m.text}`));
    this.socket.on('system:message',m=>this.appendChat(`• ${m}`));
    this.socket.on('combat:fx',fx=>this.showCombatFx(fx.x,fx.y,fx.kind,fx.amount));
    this.socket.socket.on('connect',()=>{this.failureCount=0;this.seq=0;this.pendingInputs.length=0});
    this.socket.socket.on('connect_error',()=>{this.failureCount++;this.appendChat(`Connection retry ${this.failureCount}…`)});
    this.socket.socket.on('disconnect',reason=>{if(reason==='io server disconnect')this.handleSocketFailure('Session expired. Please log in again.');else this.appendChat('Connection lost — reconnecting…')});
    this.createButtons();this.createChatInput();this.scale.on('resize',this.resizeHandler);this.events.once(Phaser.Scenes.Events.SHUTDOWN,this.shutdown,this);
  }
  private appendChat(line:string){this.chatLines.push(line);if(this.chatLines.length>6)this.chatLines.shift();this.chat?.setText(this.chatLines.join('\n'))}
  private handleSocketFailure(message:string){if(this.shuttingDown)return;this.shuttingDown=true;this.appendChat(message);this.time.delayedCall(300,()=>{if(this.scene.isActive())this.scene.start('LoginScene')})}

  private createButtons(){
    const defs:[string,()=>void][]=[
      ['ATTACK',()=>this.useSkillIndex(0)],['SKILL 2',()=>this.useSkillIndex(1)],['SKILL 3',()=>this.useSkillIndex(2)],['DASH',()=>this.useDash()],
      ['HOE',()=>this.farm('hoe')],['WHEAT',()=>this.farm('plant','wheat_seed')],['CARROT',()=>this.farm('plant','carrot_seed')],['WATER',()=>this.farm('water')],['HARVEST',()=>this.farm('harvest')],
      ['BUY C',()=>this.socket.emit('shop:buy',{itemId:'carrot_seed',quantity:1})],['BUY BOW',()=>this.socket.emit('shop:buy',{itemId:'oak_bow',quantity:1})],['BUY STAFF',()=>this.socket.emit('shop:buy',{itemId:'fire_staff',quantity:1})],
      ['SWORD',()=>this.equip('iron_sword')],['BOW',()=>this.equip('oak_bow')],['STAFF',()=>this.equip('fire_staff')],['QUESTS',()=>this.toggleQuestPanel()]
    ];
    defs.forEach(([label,fn])=>{const b=this.add.text(0,0,label,{fontSize:'11px',backgroundColor:'#1e3a8a',color:'#fff',padding:{x:6,y:5}}).setInteractive().setScrollFactor(0).setDepth(2000);b.on('pointerdown',fn);this.buttons.push(b)});this.layoutButtons();
  }
  private layoutButtons(){const w=this.scale.width,h=this.scale.height;const mobile=w<700;const cols=mobile?4:6;const gapX=mobile?64:76;const gapY=mobile?29:34;const startX=Math.max(8,w-(cols*gapX+8));const startY=Math.max(92,h-(Math.ceil(this.buttons.length/cols)*gapY+150));this.buttons.forEach((b,i)=>b.setPosition(startX+(i%cols)*gapX,startY+Math.floor(i/cols)*gapY))}

  private toggleQuestPanel(){if(!this.questPanel){this.questPanel=this.add.container(this.scale.width/2,this.scale.height/2).setScrollFactor(0).setDepth(4000);this.renderQuestPanel()}else this.questPanel.setVisible(!this.questPanel.visible)}
  private renderQuestPanel(){
    if(!this.questPanel||!this.state)return;this.questPanel.removeAll(true);
    const bg=this.add.rectangle(0,0,Math.min(520,this.scale.width-24),Math.min(300,this.scale.height-100),0x0f172a,.96).setStrokeStyle(2,0x60a5fa);this.questPanel.add(bg);
    this.questPanel.add(this.add.text(0,-120,'QUESTS',{fontSize:'20px',color:'#fff'}).setOrigin(.5));
    const ids=Object.keys(QUEST_DEFS);ids.forEach((id,index)=>{const q=this.state!.quests.find(x=>x.questId===id);const def=QUEST_DEFS[id];const y=-72+index*70;const label=this.add.text(-235,y,`${def.name}\n${q?.progress??0}/${def.amount}${q?.claimed?' ✓':''}`,{fontSize:'13px',color:'#fff'});this.questPanel!.add(label);
      if(def.kind==='deliver'&&!q?.completed&&!q?.claimed){const b=this.add.text(135,y,'DELIVER',{fontSize:'11px',backgroundColor:'#7c3aed',color:'#fff',padding:{x:8,y:5}}).setInteractive();b.on('pointerdown',()=>this.socket.emit('quest:deliver',{questId:id}));this.questPanel!.add(b)}
      if(q?.completed&&!q.claimed){const b=this.add.text(205,y,'CLAIM',{fontSize:'11px',backgroundColor:'#16a34a',color:'#fff',padding:{x:8,y:5}}).setInteractive();b.on('pointerdown',()=>this.socket.emit('quest:claim',{questId:id}));this.questPanel!.add(b)}
    });
    const close=this.add.text(205,115,'CLOSE',{fontSize:'11px',backgroundColor:'#334155',color:'#fff',padding:{x:8,y:5}}).setInteractive();close.on('pointerdown',()=>this.questPanel?.setVisible(false));this.questPanel.add(close);this.questPanel.setPosition(this.scale.width/2,this.scale.height/2);
  }

  private createChatInput(){const el=document.createElement('input');el.placeholder='World chat...';el.maxLength=200;Object.assign(el.style,{position:'fixed',right:'12px',bottom:'12px',width:'min(220px,42vw)',padding:'8px',zIndex:'10000',background:'#111827',color:'#fff',border:'1px solid #475569'});el.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'&&el.value.trim()){this.socket.emit('chat:send',{channel:'world',text:el.value.trim()});el.value=''}});document.body.appendChild(el);this.chatInput=el}
  private skillIds(){return WEAPON_DEFS[this.state?.player.weaponId||'iron_sword']?.skills??['slash']}
  private useSkillIndex(index:number){const id=this.skillIds()[index];if(id)this.skill(id)}
  private useDash(){const id=this.skillIds().find(s=>s==='dash_strike');if(id)this.skill(id);else this.appendChat('This weapon has no dash skill.')}
  private equip(itemId:string){this.socket.emit('inventory:equip',{itemId})}
  private skill(id:string){let v=this.joystick.getVector();let x=v.x,y=v.y;if(Math.hypot(x,y)<.08){x=(this.keys.D.isDown?1:0)-(this.keys.A.isDown?1:0);y=(this.keys.S.isDown?1:0)-(this.keys.W.isDown?1:0)}if(Math.hypot(x,y)<.08){const d={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]} as const;[x,y]=d[this.state?.player.dir??'down']}const l=Math.hypot(x,y)||1;this.socket.emit('skill:use',{skillId:id,x:x/l,y:y/l})}
  private farm(action:'hoe'|'plant'|'water'|'harvest',seedId?:string){if(!this.player)return;this.socket.emit('farm:action',{action,x:this.player.x,y:this.player.y,seedId})}

  update(time:number,delta:number){
    if(!this.player)return;let v=this.joystick.getVector();let x=v.x,y=v.y;if(Math.hypot(x,y)<.08){x=(this.keys.D.isDown?1:0)-(this.keys.A.isDown?1:0);y=(this.keys.S.isDown?1:0)-(this.keys.W.isDown?1:0)}const l=Math.hypot(x,y);if(l){x/=l;y/=l}
    const moveDt=Math.min(delta,100)/1000;const input:InputState={seq:this.seq+1,x,y};const speed=Math.max(0,Math.min(this.state?.player.stats.moveSpeed??MOVE_SPEED,270));
    this.player.x=Phaser.Math.Clamp(this.player.x+x*speed*moveDt,WORLD_PLAYER_MARGIN,WORLD_W-WORLD_PLAYER_MARGIN);this.player.y=Phaser.Math.Clamp(this.player.y+y*speed*moveDt,WORLD_PLAYER_MARGIN,WORLD_H-WORLD_PLAYER_MARGIN);this.player.anims.play(l>.05?'walk':'idle',true);this.player.setFlipX(x<-.05);
    if(time-this.lastInputSent>=50){this.lastInputSent=time;this.seq++;input.seq=this.seq;this.pendingInputs.push({...input});if(this.pendingInputs.length>40)this.pendingInputs.splice(0,this.pendingInputs.length-40);this.socket.emit('player:input',input)}
    const renderTime=Date.now()-this.serverClockOffset;for(const other of this.others.values())other.update(renderTime);
  }

  renderWorld(s:WorldSnapshot){
    const local=s.players.find(p=>p.id===this.socket.socket.id);
    if(local&&'stats' in local&&!this.player){this.player=this.physics.add.sprite(local.x,local.y,'player').setDepth(20).setBodySize(18,18).setOffset(7,13);this.player.setCollideWorldBounds(true);this.cameras.main.startFollow(this.player,true,.08,.08);this.cameras.main.setBounds(0,0,WORLD_W,WORLD_H)}
    this.latestServerTime=s.serverTime;this.serverClockOffset=Date.now()-s.serverTime;
    if(local&&'stats' in local&&this.player){const ack=local.lastProcessedInputSeq;this.pendingInputs=this.pendingInputs.filter(i=>i.seq>ack);this.player.setPosition(local.x,local.y);const replayDt=1/20;const speed=Math.max(0,Math.min(local.stats.moveSpeed,270));for(const i of this.pendingInputs){this.player.x=Phaser.Math.Clamp(this.player.x+i.x*speed*replayDt,WORLD_PLAYER_MARGIN,WORLD_W-WORLD_PLAYER_MARGIN);this.player.y=Phaser.Math.Clamp(this.player.y+i.y*speed*replayDt,WORLD_PLAYER_MARGIN,WORLD_H-WORLD_PLAYER_MARGIN)}this.player.setFlipX(local.dir==='left')}
    for(const p of s.players){if(p.id===this.socket.socket.id)continue;let o=this.others.get(p.id);if(!o){o=new RemotePlayer(this,p,s.serverTime);this.others.set(p.id,o)}else o.push(p,s.serverTime)}
    for(const [id,o] of this.others)if(!s.players.some(p=>p.id===id)){o.destroy();this.others.delete(id)}
    // Farm layer is now private/instanced: snapshot only contains the current owner's tiles/crops.
    const desiredTiles=new Set<string>();for(const key of s.farmTiles){const parts=key.split(':');if(parts.length!==3)continue;const gx=Number(parts[1]),gy=Number(parts[2]);if(!Number.isInteger(gx)||!Number.isInteger(gy)||gx<0||gy<0||gx>=FARM_SIZE||gy>=FARM_SIZE)continue;desiredTiles.add(key);if(!this.farmTiles.has(key)){const r=this.add.rectangle(FARM_ORIGIN.x+gx*FARM_TILE+FARM_TILE/2,FARM_ORIGIN.y+gy*FARM_TILE+FARM_TILE/2,FARM_TILE-4,FARM_TILE-4,0x8b5a2b).setDepth(4);this.farmTiles.set(key,r)}}
    for(const [key,r] of this.farmTiles)if(!desiredTiles.has(key)){r.destroy();this.farmTiles.delete(key)}
    for(const crop of s.crops){let c=this.crops.get(crop.id);if(!c){c=this.add.container(crop.x,crop.y).setDepth(10);c.add(this.add.circle(0,0,10,0x65a30d));c.add(this.add.text(0,-15,crop.seedId==='carrot_seed'?'🥕':'🌾',{fontSize:'16px'}).setOrigin(.5));this.crops.set(crop.id,c)}c.setPosition(crop.x,crop.y);c.setAlpha(crop.watered?1:.65);const icon=c.getAt(1) as Phaser.GameObjects.Text;icon.setText(crop.ready?'✨':crop.seedId==='carrot_seed'?'🥕':'🌾')}
    for(const [id,c] of this.crops)if(!s.crops.some(x=>x.id===id)){c.destroy();this.crops.delete(id)}
    for(const e of s.enemies){if(!e.alive)continue;let c=this.enemies.get(e.id);if(!c){c=this.makeEnemy();this.enemies.set(e.id,c)}c.setPosition(e.x,e.y);const hp=c.getAt(1) as Phaser.GameObjects.Rectangle;hp.scaleX=Math.max(0,e.hp/e.maxHp)}
    for(const [id,c] of this.enemies)if(!s.enemies.some(e=>e.id===id&&e.alive)){c.destroy();this.enemies.delete(id)}
    for(const d of s.drops){let c=this.drops.get(d.id);if(!c){c=this.add.container(d.x,d.y).setDepth(14).setSize(28,28);c.add([this.add.circle(0,0,8,0xfacc15),this.add.text(0,15,d.itemId,{fontSize:'9px',color:'#fff'}).setOrigin(.5)]);c.setInteractive(new Phaser.Geom.Circle(0,0,18),Phaser.Geom.Circle.Contains);c.on('pointerdown',()=>this.socket.emit('drop:pickup',{dropId:d.id}));this.drops.set(d.id,c)}else c.setPosition(d.x,d.y)}
    for(const [id,c] of this.drops)if(!s.drops.some(d=>d.id===id)){c.destroy();this.drops.delete(id)}
  }
  private showCombatFx(x:number,y:number,kind:string,amount?:number){const fx=this.add.container(x,y).setDepth(3000);fx.add(this.add.circle(0,0,18,0xfbbf24,.28));fx.add(this.add.text(0,-28,amount?`-${amount}`:kind,{fontSize:'13px',color:'#fde68a',stroke:'#111827',strokeThickness:3}).setOrigin(.5));this.tweens.add({targets:fx,alpha:0,y:y-24,duration:300,onComplete:()=>fx.destroy()})}
  private makeEnemy(){const c=this.add.container(0,0).setDepth(15);c.add([this.add.rectangle(0,0,28,28,0x7f1d1d),this.add.rectangle(-16,-24,32,4,0x22c55e).setOrigin(0,.5)]);return c}
  private refreshButtonLabels(){const ids=this.skillIds();if(this.buttons[0])this.buttons[0].setText(SKILL_DEFS[ids[0]]?.name?.toUpperCase()??'ATTACK');if(this.buttons[1])this.buttons[1].setText(SKILL_DEFS[ids[1]]?.name?.toUpperCase()??'SKILL 2');if(this.buttons[2])this.buttons[2].setText(SKILL_DEFS[ids[2]]?.name?.toUpperCase()??'SKILL 3')}
  private updateHud(){if(!this.state)return;const p=this.state.player,w=WEAPON_DEFS[p.weaponId];const inv=this.state.inventory.map(i=>`${ITEM_DEFS[i.itemId]?.icon??'?'}${i.quantity}`).join(' ');this.hud.setText(`Lv ${p.stats.level} HP ${Math.ceil(p.stats.hp)}/${p.stats.maxHp} MP ${Math.ceil(p.stats.mp)}/${p.stats.maxMp} STA ${Math.ceil(p.stats.stamina)}\nEXP ${Math.floor(p.stats.exp)}/${p.stats.expToNext} Gold ${this.state.gold} Weapon ${w?.name??'Unknown'}\n${inv}`)}
  private shutdown(){if(this.shuttingDown)return;this.shuttingDown=true;this.joystick?.destroy();this.socket?.close();this.buttons.forEach(b=>b.destroy());this.questPanel?.destroy();this.others.forEach(x=>x.destroy());this.enemies.forEach(x=>x.destroy());this.drops.forEach(x=>x.destroy());this.crops.forEach(x=>x.destroy());this.farmTiles.forEach(x=>x.destroy());this.chatInput?.remove();this.scale.off('resize',this.resizeHandler)}
}
