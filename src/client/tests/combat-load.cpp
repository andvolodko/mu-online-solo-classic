#include "stdafx.h"
#include "globals.h"
#include "functions.h"
#include "Net/Net.h"
#include <emscripten.h>
extern "C" int mu_net_connect(SOCKET, const void*, int);
extern BOOL __cdecl CSimpleModulus_LoadEncryptionKey(DWORD*, const char*);
int main() {
  if (!CSimpleModulus_LoadEncryptionKey(g_SimpleModulusCS, "Data/Enc1.dat")) return 2;
  static char entities[400*0x394] = {};
  static char attr[0x400] = {};
  static char machine[0x584] = {};
  CharactersClient=(DWORD)entities; Hero=entities;
  DAT_07cf1ff4=attr; DAT_07cf1ffc=machine;
  attr[87]=10;
  Hero[0]=1; *(float*)(Hero+16)=1000; *(float*)(Hero+20)=1000;
  char* mob=entities+0x394;
  mob[0]=1; mob[0x160]=1; mob[0x84]=2;
  *(WORD*)(mob+0x1dc)=100;
  *(float*)(mob+16)=1000; *(float*)(mob+20)=1000;
  EM_ASM({ globalThis.window={};window.soloBridge={};window.soloBridge.send=()=>{globalThis.hits=(globalThis.hits||0)+1;};window.soloBridge.connect=()=>{}; });
  mu_net_connect(1, nullptr, 0);
  SocketClientSocket=1;
  float pos[3]={1000,1000,0}, angle[3]={0,0,0}, light[3]={1,1,1};
  int failures=0;
  for (int skill : {9,14}) {
    int sparseHits = 0;
    for (int dense : {0,1}) {
      attr[87]=skill;
      memset(DAT_07b11670,0,sizeof(DAT_07b11670));
      memset(DAT_07b27150,0,sizeof(DAT_07b27150));
      if(dense) {
        for(int n=0;n<300;++n) CreateEffect(196,pos,angle,light,nullptr,nullptr,(float*)-1,nullptr,0);
        for(int n=0;n<600;++n) Joint_Create(1254,pos,pos,angle,3,0,10,-1,0);
      }
      unsigned ambientEffects=0,ambientJoints=0;
      for(unsigned i=0;i<sizeof(DAT_07b11670)/0x1bc;++i) ambientEffects+=DAT_07b11670[i*0x1bc]!=0;
      for(unsigned i=0;i<sizeof(DAT_07b27150)/0x9d8;++i) ambientJoints+=DAT_07b27150[i*0x9d8]!=0;
      if(dense && (ambientEffects>128 || ambientJoints>256)) ++failures;
      int before=EM_ASM_INT({return globalThis.hits||0;});
      if(skill==9) {
        auto joint=(unsigned char*)Joint_Create(1253,pos,pos,angle,0,(int)Hero,80,-1,0);
        if(joint) {
          for(int tick=0;tick<35 && joint[0];++tick) {
            *(float*)(mob+16)=*(float*)(joint+16);
            *(float*)(mob+20)=*(float*)(joint+20);
            MoveJoint(joint,0);
          }
        }
      } else {
        *(float*)(mob+16)=1000;*(float*)(mob+20)=1000;
        CreateEffect(241,pos,angle,light,nullptr,(float*)Hero,(float*)-1,nullptr,0);
      }
      int hits=EM_ASM_INT({return globalThis.hits||0;})-before;
      printf("skill=%d dense=%d packets=%d\n",skill,dense,hits);
      if(!dense) sparseHits=hits;
      if(hits<1 || hits!=sparseHits) ++failures;
    }
  }
  puts(failures ? "FAIL: combat under visual load" : "PASS: Evil Spirit and Inferno retain hit packets under visual load");
  return failures?1:0;
}
