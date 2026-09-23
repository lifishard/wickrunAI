const test=require('node:test'),assert=require('node:assert/strict');
const {sendClientEvent}=require('../electron/client-events.cjs');
test('client progress goes only to its live renderer',()=>{
  const sent=[],sender={isDestroyed:()=>false,send:(...args)=>sent.push(args)};
  assert.equal(sendClientEvent(sender,{type:'activity'}),true);assert.deepEqual(sent,[['snc:clientEvent',{type:'activity'}]]);
  sender.isDestroyed=()=>true;assert.equal(sendClientEvent(sender,{type:'waiting'}),false);assert.equal(sent.length,1);
});
test('closing a window during a send cannot cause an uncaught main-process exception',()=>{
  const sender={isDestroyed:()=>false,send(){throw new TypeError('Object has been destroyed');}};
  assert.equal(sendClientEvent(sender,{type:'delta'}),false);
  sender.send=()=>{throw new Error('Unserializable event');};assert.throws(()=>sendClientEvent(sender,{}),/Unserializable/);
});
