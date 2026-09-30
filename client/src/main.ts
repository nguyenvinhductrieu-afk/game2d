import Phaser from 'phaser';
import { LoginScene } from './game/scenes/LoginScene.js';
import { MainScene } from './game/scenes/MainScene.js';
import './style.css';

new Phaser.Game({type:Phaser.AUTO,parent:'game',width:1280,height:720,pixelArt:true,roundPixels:true,scale:{mode:Phaser.Scale.RESIZE,autoCenter:Phaser.Scale.CENTER_BOTH},physics:{default:'arcade',arcade:{gravity:{x:0,y:0}}},scene:[LoginScene,MainScene]});
