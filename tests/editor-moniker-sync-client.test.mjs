import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/record-editor.js',import.meta.url),'utf8');
const start=source.indexOf("  window.addEventListener('hauntologies-public-moniker-changed'"),end=source.indexOf("  message.addEventListener('input'",start);

function fixture(){
 const drafts=new Map(),active={actor_id:'actor-a',moniker:'old',preview:{ready:true}},other={actor_id:'actor-b',moniker:'other'},pending={actor_id:'actor-a',moniker:'pending',pending:{body:'unchanged'}},revision={actor_id:'actor-a',moniker:'original',revisionOf:{id:'prior'}},saved={actor_id:'actor-a',moniker:'published',saved:{}};
 for(const [key,value] of Object.entries({active,other,pending,revision,saved}))drafts.set(key,value);
 let listener,changed=0,currentAccount={actor:'actor-a',generation:1},allowed=true;const input={value:'old'};
 const window={HauntologiesAccount:{snapshot:()=>currentAccount,isCurrent:expected=>allowed&&expected===currentAccount},addEventListener:(_name,fn)=>listener=fn};
 const context=vm.createContext({window,drafts,current:active,byId:()=>input,changed:()=>changed++});
 assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),context);
 return {active,other,pending,revision,saved,input,changed:()=>changed,send:detail=>listener({detail}),deny:()=>allowed=false};
}
test('an Account username update reaches unsent edit drafts without changing pending, old or other-account work',()=>{
 const h=fixture();h.send({actor:'actor-a',label:'night.owl'});
 assert.equal(h.active.moniker,'night.owl');assert.equal(h.active.preview,null);assert.equal(h.input.value,'night.owl');assert.equal(h.changed(),1);
 assert.equal(h.other.moniker,'other');assert.equal(h.pending.moniker,'pending');assert.equal(h.revision.moniker,'original');assert.equal(h.saved.moniker,'published');
});
test('username updates require the same active account and reject email-like values',()=>{
 const h=fixture();h.send({actor:'actor-b',label:'wrong'});h.send({actor:'actor-a',label:'mail@example.test'});h.deny();h.send({actor:'actor-a',label:'later'});
 assert.equal(h.active.moniker,'old');assert.equal(h.changed(),0);
});
