"""Browser regression: Arcadia, Soul Master, AGI 20000/ENE 30000, Beam Knight pack.
Run with Python + Playwright installed: python3 src/client/tests/stadium_combat.py
Uses an isolated dummy save and its own localhost server. Requires Chrome.
"""
import json
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

    def log_message(self, *_args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT / 'web')))
Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}'
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'), headless=True,
            args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        page = browser.new_page(viewport={'width':1280, 'height':800})
        page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(url + '/') else route.abort())
        fixture = (Path(__file__).parent / 'stadium-soul-master.json').read_text()
        page.add_init_script("localStorage.setItem('mu_solo_realm_0_vault'," + json.dumps(fixture) + ');')
        page.add_init_script("""
          window.__damages=[]; window.__beams=new Set(); window.__stats=null;
          window.__chat=text=>{
            const key=[231,109,58,137,188,178,159,115,35,168,254,182,73,93,57,93,138,203,99,141,234,125,43,95,195,177,233,131,41,81,232,86];
            const bytes=new Uint8Array(73);bytes.set([193,73,0]);
            bytes.set(new TextEncoder().encode('GMTester'),3);
            bytes.set(new TextEncoder().encode(text),13);
            for(let i=3;i<73;++i) bytes[i]^=bytes[i-1]^key[i&31];
            window.soloBridge.send(bytes);
          };
          const RealWorker=window.Worker;
          window.Worker=class extends RealWorker {
            constructor(...args){super(...args);this.addEventListener('message',event=>{
              const msg=event.data;if(msg.type!=='PACKET_FROM_SERVER')return;
              const b=msg.data;
              if(b[0]===193 && b[2]===243 && b[3]===224){
                const view=new DataView(b.buffer,b.byteOffset,b.byteLength);
                window.__stats={agi:view.getUint32(24,true),ene:view.getUint32(32,true)};
                // Protect the fixture during map loading; disable BEFORE fighting.
                setTimeout(()=>window.__chat('/gm on'),0);
              }
              const offset=b[0]===194?1:0;
              if((b[0]===193||b[0]===194) && b[2+offset]===19){
                for(let i=0;i<b[3+offset];++i){
                  const e=4+offset+i*12;
                  if(b[e+2]===61)window.__beams.add(((b[e]&127)<<8)|b[e+1]);
                }
              }
              // Do not interpret encrypted C3 payload bytes as packet opcodes.
              if(b[0]===193 && b.length===16 && b[2]===21){
                const view=new DataView(b.buffer,b.byteOffset,b.byteLength);
                window.__damages.push({id:((b[3]&127)<<8)|b[4],hp:view.getUint32(8,true),damage:view.getUint32(12,true)});
              }
            });}
          };
        """)
        errors=[]
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda msg: errors.append(msg.text) if 'callback error' in msg.text or 'RuntimeError:' in msg.text else None)
        page.goto(url + '/?u=gmtest&p=gmtest', wait_until='domcontentloaded')
        page.wait_for_timeout(18000)
        def click(x,y,delay):
            page.mouse.move(x,y);page.mouse.down();page.wait_for_timeout(180);page.mouse.up();page.wait_for_timeout(delay)
        click(365,400,1800);click(365,400,1800);click(410,480,500);click(950,289,2000)
        assert page.evaluate('window.__stats') == {'agi':20000,'ene':30000}
        hero=page.evaluate("""()=>{
          const h=Module.HEAPU8,v=new DataView(h.buffer),name=new TextEncoder().encode('GMTester');
          for(let p=449;p<h.length-916;++p){
            if(h[p]!==71||h[p+1]!==77||!name.every((c,i)=>h[p+i]===c))continue;
            const b=p-449;
            if(h[b]===1&&v.getUint16(b+2,true)===390&&v.getUint16(b+476,true)===9000&&
               Math.abs(v.getFloat32(b+16,true)-2850)<1&&Math.abs(v.getFloat32(b+20,true)-9250)<1)return b;
          }throw new Error('hero not in centre of Beam Knight pack');
        }""")
        assert page.evaluate('window.__beams.size') >= 18
        page.evaluate("window.__chat('/gm off')")
        page.wait_for_timeout(300)
        for slot, skill in [(0,'Evil Spirit'),(1,'Inferno')]:
            page.evaluate('({hero,slot})=>{Module.HEAPU8[hero+913]=slot;window.__damages=[];Module._mu_auto_attack(1);}', {'hero':hero,'slot':slot})
            for checkpoint in range(3):
                page.wait_for_timeout(2000)
                result=page.evaluate("""hero=>({dead:Module.HEAPU8[hero+765],
                  hits:window.__damages.filter(d=>window.__beams.has(d.id)&&d.damage>0).length,
                  damaged:window.__damages.filter(d=>window.__beams.has(d.id)&&d.damage>0&&d.hp<17500).length})""",hero)
                print(skill,checkpoint,result,flush=True)
                assert result['dead']==0, 'fixture must remain alive during combat'
                assert result['damaged']>0, 'Beam Knights must lose server HP; visible numbers alone are insufficient'
            page.evaluate('Module._mu_auto_attack(0)')
            page.wait_for_timeout(1000)
        page.evaluate('window.muOpenInfoModal()')
        assert page.locator('#muBuildVersion').inner_text() == '(login110)'
        assert not errors, errors
        browser.close()
        print('PASS: both skills damage Beam Knights in Stadium at AGI 20000/ENE 30000; no runtime errors')
finally:
    server.shutdown()
    server.server_close()
