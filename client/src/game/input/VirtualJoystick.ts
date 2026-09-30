import Phaser from 'phaser';

export class VirtualJoystick{
  private base:Phaser.GameObjects.Arc;private thumb:Phaser.GameObjects.Arc;private vector=new Phaser.Math.Vector2();private active=-1;private radius=62;private enabled=false;private readonly deadzone=.12;
  private readonly resizeHandler=()=>this.handleResize();
  private readonly pointerDownHandler=(p:Phaser.Input.Pointer)=>{if(!this.enabled||this.active!==-1||p.x>230||p.y<this.scene.scale.height-230)return;this.active=p.id;this.update(p)};
  private readonly pointerMoveHandler=(p:Phaser.Input.Pointer)=>{if(p.id===this.active)this.update(p)};
  private readonly pointerUpHandler=(p:Phaser.Input.Pointer)=>{if(p.id!==this.active)return;this.release()};
  private readonly pointerOutHandler=()=>{if(this.active!==-1)this.release()};
  private destroyed=false;
  constructor(private scene:Phaser.Scene){
    this.enabled='ontouchstart' in window||scene.scale.width<900;
    const y=()=>scene.scale.height-110;
    this.base=scene.add.circle(95,y(),this.radius,0x111827,.45).setScrollFactor(0).setDepth(1000);
    this.thumb=scene.add.circle(95,y(),28,0xffffff,.6).setScrollFactor(0).setDepth(1001);
    this.setVisible(this.enabled);
    scene.scale.on('resize',this.resizeHandler);scene.input.on('pointerdown',this.pointerDownHandler);scene.input.on('pointermove',this.pointerMoveHandler);scene.input.on('pointerup',this.pointerUpHandler);scene.input.on('pointerupoutside',this.pointerOutHandler);scene.events.once(Phaser.Scenes.Events.SHUTDOWN,()=>this.destroy());
  }
  private handleResize(){if(this.destroyed)return;this.base.setPosition(95,this.scene.scale.height-110);if(this.active<0)this.thumb.setPosition(this.base.x,this.base.y);this.enabled='ontouchstart' in window||this.scene.scale.width<900;this.setVisible(this.enabled);if(!this.enabled)this.release()}
  private setVisible(v:boolean){this.base.setVisible(v);this.thumb.setVisible(v)}
  private release(){this.active=-1;this.vector.set(0,0);this.thumb.setPosition(this.base.x,this.base.y)}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.release();this.scene.scale.off('resize',this.resizeHandler);this.scene.input.off('pointerdown',this.pointerDownHandler);this.scene.input.off('pointermove',this.pointerMoveHandler);this.scene.input.off('pointerup',this.pointerUpHandler);this.scene.input.off('pointerupoutside',this.pointerOutHandler);this.base.destroy();this.thumb.destroy()}
  private update(p:Phaser.Input.Pointer){const dx=p.x-this.base.x,dy=p.y-this.base.y,l=Math.hypot(dx,dy);if(l<1){this.vector.set(0,0);return}const d=Math.min(l,this.radius),m=d/this.radius;if(m<this.deadzone){this.vector.set(0,0)}else{const scaled=(m-this.deadzone)/(1-this.deadzone);this.vector.set((dx/l)*scaled,(dy/l)*scaled)}this.thumb.setPosition(this.base.x+dx/l*d,this.base.y+dy/l*d)}
  getVector(){return this.vector.clone()}
}
