// Compile the real popup producer, tick and renderer with a draw-call recorder.
// No game assets or browser are required. Run: node src/client/test-damage-popups.cjs
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const root = __dirname;
function body(file, signature) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const start = text.indexOf(signature);
  if (start < 0) throw new Error(`Missing function: ${signature}`);
  const end = text.indexOf('\n}', start);
  if (end < 0) throw new Error('Missing function end');
  return text.slice(start, end + 2);
}
const code = `
#include <cassert>
#include <cstdio>
#include <cstring>
#include <cstdint>
#include <vector>
#include <algorithm>
#define __cdecl
#define GL_TEXTURE_ENV 0
#define GL_TEXTURE_ENV_MODE 0
#define GL_MODULATE 0
using undefined1 = unsigned char;
char DAT_07c80110[100 * 0x70] = {};
float _DAT_00552958 = 140.0f, _DAT_005528b8 = .3f;
float _DAT_00552580 = 0.0f, _DAT_00552660 = 5.0f, _DAT_00552834 = 15.0f;
std::vector<int> rendered;
void EnableAlphaTest(bool) {}
void GL_DisableDepthTest() {}
void glTexEnvf(int, int, float) {}
void RenderNumber(float*, int value, float*, float alpha, float) {
  assert(alpha > 0); rendered.push_back(value);
}
${body('src/Combat/Skills_WarriorLegacy.cpp', 'void __cdecl Entity_TeleportAnim(float* world_pos,')}
${body('src/Entity/Entity_LegacyTeleport.cpp', 'extern "C" void __cdecl CreatePoint(float Position[3],')}
${body('src/Render/Effect_Tick.cpp', 'void DamageNumbers_Tick(void)')}
${body('src/Render/Render_LegacyDamageNumbers.cpp', 'void __cdecl RenderPoints(int, int, int, int)')}
float pos[3] = {100, 200, 20}, color[3] = {1, .6f, 0};
void hit(int value) { CreatePoint(pos, value, color, 15); }
bool visible(int value) {
  rendered.clear(); RenderPoints(0,0,0,0);
  return std::find(rendered.begin(), rendered.end(), value) != rendered.end();
}
int main() {
  // Sparse combat keeps exact values, including the MISS bit pattern.
  hit(-1); hit(123456); assert(visible(-1)); assert(visible(123456));
  for (int i=0; i<40; ++i) DamageNumbers_Tick();
  rendered.clear(); RenderPoints(0,0,0,0); assert(rendered.empty());
  // An AoE/monster burst fills the pool; subsequent hits must still render.
  for (int i=1; i<=100; ++i) hit(i);
  hit(999999);
  if (!visible(999999)) {
    std::fprintf(stderr, "FAIL: fresh damage 999999 disappeared with 100 active popups\\n");
    return 1;
  }
  assert(!visible(1)); // replace the oldest, rather than an arbitrary fresh hit
  for (int value=1000; value<1400; ++value) hit(value);
  for (int value=1300; value<1400; ++value) assert(visible(value));
  assert(!visible(1299));
  // Sustained saturation: newest events remain visible; work stays bounded.
  for (int frame=0; frame<1000; ++frame) {
    for (int n=0; n<30; ++n) hit(1000000 + frame*30 + n);
    DamageNumbers_Tick();
    assert(visible(1000000 + frame*30 + 29));
    assert(rendered.size() <= 100);
  }
  // Freed slots can be reused without stale state, even after saturation.
  for (int i=0; i<40; ++i) DamageNumbers_Tick();
  hit(-1); hit(7654321);
  assert(visible(-1)); assert(visible(7654321));
  assert(rendered.size() == 2);
  std::puts("PASS: sparse hits, MISS, expiry, burst overflow and 30,000 sustained hits");
}
`;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mu-damage-'));
try {
  fs.writeFileSync(path.join(temp, 'test.cpp'), code);
  cp.execFileSync('c++', ['-std=c++17', '-O2', '-fno-strict-aliasing', path.join(temp, 'test.cpp'), '-o', path.join(temp, 'test')], {stdio:'inherit'});
  cp.execFileSync(path.join(temp, 'test'), {stdio:'inherit'});
} finally { fs.rmSync(temp, {recursive:true, force:true}); }
