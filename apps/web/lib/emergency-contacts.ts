/** Device-local only. Contacts never leave the browser and are never sent to 72H servers. */
export type EmergencyContact={name:string;phone:string};
export type SosProfile={contacts:EmergencyContact[];needsAssistance:boolean;mobilityLimited:boolean};
export const SOS_ONBOARDED_KEY='72h-sos-onboarded';
const DB='72h-sos',STORE='profile',KEY='v1',EMPTY:SosProfile={contacts:[],needsAssistance:false,mobilityLimited:false};
const PHONE=/^\+?[0-9][0-9-]{2,19}$/;
export function validateContact(c:unknown):EmergencyContact|null{
 if(!c||typeof c!=='object')return null;const {name,phone}=c as Record<string,unknown>;
 if(typeof name!=='string'||typeof phone!=='string')return null;const n=name.trim(),p=phone.trim();
 return n.length>=1&&n.length<=40&&PHONE.test(p)?{name:n,phone:p}:null;
}
export type SosStorage={get():Promise<unknown>;put(value:unknown):Promise<void>};
function open():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
const indexedDbStorage:SosStorage={
 async get(){const db=await open();try{return await new Promise<unknown>((resolve,reject)=>{const q=db.transaction(STORE).objectStore(STORE).get(KEY);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}finally{db.close();}},
 async put(value){const db=await open();try{await new Promise<void>((resolve,reject)=>{const t=db.transaction(STORE,'readwrite');t.objectStore(STORE).put(value,KEY);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);});}finally{db.close();}},
};
let storage:SosStorage=indexedDbStorage;
export function setSosStorage(next:SosStorage){storage=next;}
export async function loadSosProfile():Promise<SosProfile>{
 try{const value=await storage.get();
  if(!value||typeof value!=='object')return EMPTY;const v=value as Record<string,unknown>;
  const contacts=Array.isArray(v.contacts)?v.contacts.map(validateContact).filter((c):c is EmergencyContact=>!!c).slice(0,3):[];
  return {contacts,needsAssistance:v.needsAssistance===true,mobilityLimited:v.mobilityLimited===true};
 }catch{return EMPTY;}
}
export async function saveSosProfile(p:SosProfile):Promise<boolean>{
 if(p.contacts.length>3)return false;const contacts=p.contacts.map(validateContact);if(contacts.some(c=>!c))return false;
 try{await storage.put({contacts,needsAssistance:!!p.needsAssistance,mobilityLimited:!!p.mobilityLimited});return true;}
 catch{return false;}
}
/** First-use setup must never compete with, or precede, urgent guidance. */
export function shouldShowSosSetup(i:{view:string;open:boolean;urgent:boolean;criticalProtection:boolean}):boolean{
 return i.view==='dashboard'&&i.open&&!i.urgent&&!i.criticalProtection;
}
