import Phaser from 'phaser';
import { SERVER_URL } from '../config/constants.js';

export class LoginScene extends Phaser.Scene{
  private email!:HTMLInputElement;private password!:HTMLInputElement;private nameInput!:HTMLInputElement;private message!:Phaser.GameObjects.Text;private mode:'login'|'register'='login';private button!:Phaser.GameObjects.Text;private toggle!:Phaser.GameObjects.Text;private resizeHandler=()=>this.layout();private fieldHandlers=new Map<HTMLInputElement,(e:KeyboardEvent)=>void>();
  constructor(){super('LoginScene')}
  create(){
    this.mode='login';this.cameras.main.setBackgroundColor('#111827');
    this.add.text(this.scale.width/2,70,'FARM & DUNGEON ONLINE',{fontSize:'30px',color:'#f8fafc'}).setOrigin(.5);this.add.text(this.scale.width/2,110,'Online 2D Farming + Dungeon MMORPG',{fontSize:'16px',color:'#94a3b8'}).setOrigin(.5);
    this.email=this.inputField('Email','email','email',190);this.password=this.inputField('Password','password','current-password',245);this.nameInput=this.inputField('Character name','text','name',300);this.nameInput.style.display='none';
    this.button=this.add.text(this.scale.width/2,365,'LOGIN',{fontSize:'20px',backgroundColor:'#2563eb',color:'#fff',padding:{x:28,y:12}}).setOrigin(.5).setInteractive();this.button.on('pointerdown',()=>void this.submit());
    this.toggle=this.add.text(this.scale.width/2,425,'Create account instead',{fontSize:'15px',color:'#60a5fa'}).setOrigin(.5).setInteractive();this.toggle.on('pointerdown',()=>this.setMode(this.mode==='login'?'register':'login'));
    this.message=this.add.text(this.scale.width/2,475,'',{fontSize:'15px',color:'#fca5a5',align:'center',wordWrap:{width:420}}).setOrigin(.5);
    [this.email,this.password,this.nameInput].forEach(el=>{const handler=(e:KeyboardEvent)=>{if(e.key==='Enter'){e.preventDefault();void this.submit()}};this.fieldHandlers.set(el,handler);el.addEventListener('keydown',handler)});
    this.scale.on('resize',this.resizeHandler);this.layout();this.events.once(Phaser.Scenes.Events.SHUTDOWN,this.shutdown,this);
  }
  private inputField(placeholder:string,type:string,autocomplete:string,y:number){const el=document.createElement('input');el.placeholder=placeholder;el.type=type;el.setAttribute('autocomplete',autocomplete);Object.assign(el.style,{position:'fixed',left:'50%',top:`${y}px`,transform:'translateX(-50%)',width:'280px',padding:'12px',fontSize:'16px',borderRadius:'8px',border:'1px solid #475569',background:'#1e293b',color:'#fff',zIndex:'10000'});document.body.appendChild(el);return el}
  private layout(){const y=[190,245,300];[this.email,this.password,this.nameInput].forEach((e,i)=>{if(e)e.style.top=`${y[i]}px`});this.button?.setPosition(this.scale.width/2,365);this.toggle?.setPosition(this.scale.width/2,425);this.message?.setPosition(this.scale.width/2,475)}
  private setMode(mode:'login'|'register'){this.mode=mode;this.nameInput.style.display=mode==='register'?'block':'none';this.password.autocomplete=mode==='register'?'new-password':'current-password';this.button.setText(mode==='login'?'LOGIN':'REGISTER');this.toggle.setText(mode==='login'?'Create account instead':'Back to login');this.message.setText('')}
  private async submit(){this.button.disableInteractive();this.message.setText('Connecting...');try{const res=await fetch(`${SERVER_URL}/api/auth/${this.mode==='login'?'login':'register'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:this.email.value,password:this.password.value,...(this.mode==='register'?{name:this.nameInput.value}:{})})});const data=await res.json().catch(()=>({error:'Invalid server response'}));if(!res.ok)throw new Error(data.error||'Request failed');localStorage.setItem('token',data.token);localStorage.setItem('playerName',data.name);this.scene.start('MainScene')}catch(e){this.message.setText(e instanceof Error?e.message:'Login failed')}finally{if(this.scene.isActive())this.button.setInteractive()}}
  private cleanup(){for(const [el,handler] of this.fieldHandlers)el.removeEventListener('keydown',handler);this.fieldHandlers.clear();[this.email,this.password,this.nameInput].forEach(e=>e?.remove()) ;this.scale.off('resize',this.resizeHandler)}
  private shutdown(){this.cleanup()}
}
