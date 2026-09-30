type Level='debug'|'info'|'warn'|'error';
function write(level:Level,message:string,meta?:Record<string,unknown>){
  const record={ts:new Date().toISOString(),level,message,...meta};
  const line=JSON.stringify(record);
  if(level==='error')console.error(line);else if(level==='warn')console.warn(line);else console.log(line);
}
export const logger={debug:(m:string,x?:Record<string,unknown>)=>write('debug',m,x),info:(m:string,x?:Record<string,unknown>)=>write('info',m,x),warn:(m:string,x?:Record<string,unknown>)=>write('warn',m,x),error:(m:string,x?:Record<string,unknown>)=>write('error',m,x)};
