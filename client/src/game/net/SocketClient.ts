import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@farm-dungeon/shared';
import { SERVER_URL } from '../config/constants.js';

export class SocketClient {
  readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private intentionallyClosed=false;

  constructor() {
    const token=localStorage.getItem('token')||'';
    this.socket=io(SERVER_URL,{auth:{token},autoConnect:true,reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:300,reconnectionDelayMax:3000,timeout:8000,randomizationFactor:.2});
    this.socket.on('connect',()=>{this.socket.auth={token:localStorage.getItem('token')||''};});
  }
  on<E extends keyof ServerToClientEvents>(event:E,fn:(...args:Parameters<ServerToClientEvents[E]>)=>void){
    // socket.io's generic listener overload cannot preserve the indexed function type
    // through E. Keep the public API type-safe and narrow the cast at this adapter boundary.
    const socket = this.socket as unknown as {
      on: (event: string, listener: (...args: any[]) => void) => unknown;
      off: (event: string, listener: (...args: any[]) => void) => unknown;
    };
    const listener = fn as (...args: any[]) => void;
    socket.on(event as string, listener);
    return () => { socket.off(event as string, listener); };
  }
  once<E extends keyof ServerToClientEvents>(event:E,fn:(...args:Parameters<ServerToClientEvents[E]>)=>void){
    const socket = this.socket as unknown as {
      once: (event: string, listener: (...args: any[]) => void) => unknown;
    };
    socket.once(event as string, fn as (...args: any[]) => void);
  }
  emit<E extends keyof ClientToServerEvents>(event:E,...args:Parameters<ClientToServerEvents[E]>) {this.socket.emit(event,...args);}
  close(){this.intentionallyClosed=true;this.socket.removeAllListeners();this.socket.disconnect();}
  get intentionalClosed(){return this.intentionallyClosed;}
}
