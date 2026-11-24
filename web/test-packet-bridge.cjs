// Exercise the production worker callback and SEND_PACKET handler under bursts.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/server_worker.js', 'utf8');
const start = source.indexOf('const sendCallback = Module.addFunction(') + 'const sendCallback = Module.addFunction('.length;
const end = source.indexOf("}, 'vii');", start) + 1;
assert(start > 0 && end > start);
async function run(debug) {
  const heap = new Uint8Array(65536);
  const messages = [], incoming = [];
  const module = {
    HEAPU8:heap,
    _malloc:() => 1024,
    _free:() => {},
    _SoloServer_ReceiveClientPacket:(ptr, len) => incoming.push(Array.from(heap.subarray(ptr,ptr+len)))
  };
  const context = vm.createContext({
    URLSearchParams, Uint8Array, performance,
    importScripts:() => {},
    __module:module,
    self: {
      location:{search:debug ? '?debugPackets=1' : ''},
      postMessage:(message, transfer) => {
        // Use real structured-clone transfer semantics, including detachment.
        messages.push(structuredClone(message, {transfer:transfer || []}));
      }
    }
  });
  vm.runInContext(source + '; Module = __module;',context);
  const send = vm.runInContext('(' + source.slice(start,end) + ')', context);
  const count = 10000;
  const began = performance.now();
  for (let i=0; i<count; ++i) {
    heap.set([0xc1,7,0x15,i>>8,i&255,0,123],32);
    send(32,7);
  }
  const ms = performance.now() - began;
  const packets = messages.filter(m => m.type === 'PACKET_FROM_SERVER');
  const logs = messages.filter(m => m.type === 'LOG');
  console.log(`${debug ? 'debug' : 'normal'}: ${count} packets, ${messages.length} messages, ${logs.length} trace logs, ${ms.toFixed(1)}ms`);
  assert.equal(packets.length,count,'no lost damage packets');
  assert.equal(logs.length,debug ? count : 0,'packet logs must be opt-in');
  assert(packets[0].data instanceof Uint8Array,'binary packets, no boxed number arrays');
  for (let i=0; i<count; ++i) assert.deepEqual(Array.from(packets[i].data),[0xc1,7,0x15,i>>8,i&255,0,123]);
  assert.equal(heap.byteLength,65536,'WASM heap must never be detached');
  await context.self.onmessage({data:{action:'SEND_PACKET',payload:{bytes:new Uint8Array([0xc1,4,0x0e,99])}}});
  assert.deepEqual(incoming,[[0xc1,4,0x0e,99]],'client packet preserved');
  // Diagnostics unrelated to per-packet traces remain available.
  vm.runInContext("log('error remains visible', '#f87171')",context);
  assert.equal(messages.at(-1).message,'error remains visible');
}
// Exercise the actual main-thread sender with a view into a simulated WASM heap.
const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
const sender = app.match(/send: (function \(uint8Data\) \{[\s\S]*?\n    \}),/);
assert(sender, 'main-thread bridge sender found');
const heap = new Uint8Array([0xc1,4,0x0e,99]);
let delivered;
const senderContext = vm.createContext({Uint8Array, console, workerReady:true, worker:{
  postMessage:(message, transfer) => {
    assert.equal(transfer.length,1,'one owned buffer is transferred');
    delivered = structuredClone(message,{transfer});
  }
}});
vm.runInContext('(' + sender[1] + ')',senderContext)(heap.subarray(0));
assert(delivered.payload.bytes instanceof Uint8Array);
assert.deepEqual(Array.from(delivered.payload.bytes), Array.from(heap));
assert.equal(heap.byteLength,4,'caller heap stays attached');
heap[3] = 0;
assert.equal(delivered.payload.bytes[3],99,'packet owns its bytes after send');
(async () => { await run(false); await run(true); console.log('PASS: binary transfer, ordering, heap ownership and optional packet traces'); })().catch(error => { console.error(error); process.exitCode=1; });
