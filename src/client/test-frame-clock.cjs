// Test the real browser clock with a simulated slow renderer; no wall-clock sleeps.
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const source = fs.readFileSync(__dirname+'/src/Game/FrameLimiter.cpp','utf8');
const begin = source.indexOf('DWORD CFrameLimiter::Wait(');
const end = source.indexOf('\n}',begin)+2;
const header = fs.readFileSync(__dirname+'/src/Game/FrameLimiter.h','utf8').replace('#pragma once','').replace('#include <windows.h>','');
const loop = fs.readFileSync(__dirname+'/src/Game/Game_MainLoop.cpp','utf8');
const budget = loop.match(/int browserTicks = 0;\n    while \(([^\n]+)\) \{/);
if (!budget) throw new Error('Missing bounded browser logic loop');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'mu-clock-'));
try {
  fs.writeFileSync(path.join(dir,'test.cpp'),`
#include <cstdint>
#include <cstdio>
#include <cassert>
#define __EMSCRIPTEN__
using DWORD=uint32_t;
using HANDLE=void*;
struct LARGE_INTEGER {long long QuadPart=0;};
static long long now=1000;
int QueryPerformanceFrequency(LARGE_INTEGER* p){p->QuadPart=1000;return 1;}
int QueryPerformanceCounter(LARGE_INTEGER* p){p->QuadPart=now;return 1;}
DWORD GetTickCount(){return now;}
${header}
CFrameLimiter::~CFrameLimiter() {}
${source.slice(begin,end)}
int main(){
  CFrameLimiter clock;
  clock.Wait({});
  unsigned total=0,ticks=0,DAT_005616b8=0;

  for(int frame=0;frame<10;++frame){
    now+=100; const auto elapsed=clock.Wait({});total+=elapsed;
    DAT_005616b8+=elapsed;
    int browserTicks=0;
    while(${budget[1]}) {DAT_005616b8-=40;++ticks;}
  }
  assert(ticks==25);
  if(total!=1000){printf("FAIL: 10 FPS discarded combat time: %u/1000 ms\\n",total);return 1;}
  now+=60000;
  const auto resume=clock.Wait({});
  assert(resume<=120); // bounded recovery after a hidden tab or stall
  printf("PASS: slow frames retain elapsed time; resume bounded at %u ms\\n",resume);
}
`);
  cp.execFileSync('c++',['-std=c++17','-O2',path.join(dir,'test.cpp'),'-o',path.join(dir,'test')],{stdio:'inherit'});
  cp.execFileSync(path.join(dir,'test'),{stdio:'inherit'});
} finally {fs.rmSync(dir,{recursive:true,force:true});}
