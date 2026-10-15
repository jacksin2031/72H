const SERVICE_WORKER_CONTROL_TIMEOUT_MS=5000;

/** Registers the public offline shell and waits briefly for this page to be claimed. */
export function ensureOfflineAssetControl(signal?:AbortSignal):Promise<boolean>{
  if(typeof window==='undefined'||process.env.NODE_ENV!=='production'||!('serviceWorker' in navigator))return Promise.resolve(false);
  const serviceWorker=navigator.serviceWorker;
  if(serviceWorker.controller)return Promise.resolve(true);
  if(signal?.aborted)return Promise.resolve(false);

  return new Promise(resolve=>{
    let settled=false;
    const finish=(controlled:boolean)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timeout);
      serviceWorker.removeEventListener('controllerchange',checkController);
      signal?.removeEventListener('abort',onAbort);
      resolve(controlled);
    };
    const checkController=()=>{if(serviceWorker.controller)finish(true);};
    const onAbort=()=>finish(false);
    const timeout=setTimeout(()=>finish(false),SERVICE_WORKER_CONTROL_TIMEOUT_MS);
    serviceWorker.addEventListener('controllerchange',checkController);
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted){finish(false);return;}
    try{
      void serviceWorker.register('/sw.js').then(checkController,()=>finish(false));
    }catch{finish(false);}
    checkController();
  });
}
