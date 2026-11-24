// Activate emsdk and build the client first, then:
// node src/client/test-combat-load.cjs
// Links the real game code into a small Node/WASM runner with no rendering.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const root = __dirname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'mu-combat-load-'));
try {
  const objectDir = path.join(root,'out/all');
  if (!fs.existsSync(objectDir)) throw new Error('Build the client first (out/all/*.o required).');
  const emcc = process.env.EMCC || 'emcc';
  const includes = ['browser','browser/compat','src','lib/libjpeg/jpeg-6b','lib/miniaudio'].flatMap(d => ['-I',path.join(root,d)]);
  // Compatibility for the source's Windows GL include casing on Linux.
  fs.mkdirSync(path.join(dir,'gl'));
  fs.writeFileSync(path.join(dir,'gl/gl.h'),'#include <GL/gl.h>\n');
  fs.writeFileSync(path.join(dir,'gl/GL.h'),'#include <GL/gl.h>\n');
  fs.writeFileSync(path.join(dir,'gl/glu.h'),'#include <GL/glu.h>\n');
  includes.push('-I',dir);
  const replaced = new Set(['browser_shell_login.o','src_Render_Effect_Create.o','src_Render_Joint_Create.o']);
  const objects = fs.readdirSync(objectDir).filter(f => f.endsWith('.o') && !replaced.has(f)).map(f=>path.join(objectDir,f));
  for (const [source,name,extra] of [
    ['tests/combat-load.cpp','test.o',[]],
    ['browser/shell_login.cpp','shell.o',['-Dmain=mu_browser_main']],
    ['src/Render/Effect_Create.cpp','effects.o',[]],
    ['src/Render/Joint_Create.cpp','joints.o',[]]
  ]) {
    const object = path.join(dir,name);
    cp.execFileSync(emcc,['-c','-std=c++17','-O2','-Wno-macro-redefined','-Wno-ignored-attributes',...includes,...extra,path.join(root,source),'-o',object],{stdio:'inherit'});
    objects.push(object);
  }
  const response = path.join(dir,'objects.rsp');
  fs.writeFileSync(response,objects.map(p=>JSON.stringify(p.replaceAll('\\','/'))).join('\n'));
  const output = path.join(dir,'combat.js');
  cp.execFileSync(emcc,['-std=c++17','--profiling-funcs','-sEMULATE_FUNCTION_POINTER_CASTS=1','-sDEFAULT_TO_CXX','@'+response,
    '-o',output,'-sMODULARIZE=1','-sEXPORT_NAME=createCombatTest','-sENVIRONMENT=node','-sLEGACY_GL_EMULATION',
    '-sGL_FFP_ONLY','-sMIN_WEBGL_VERSION=2','-sMAX_WEBGL_VERSION=2','-sINITIAL_MEMORY=536870912',
    '-sSTACK_SIZE=8388608','-sFORCE_FILESYSTEM=1','-sALLOW_MEMORY_GROWTH=0','-sEXPORTED_RUNTIME_METHODS=HEAPU8',
    '--embed-file',path.join(root,'Client/Data/Enc1.dat')+'@/Data/Enc1.dat'],{stdio:'inherit'});
  cp.execFileSync(process.execPath,['-e',`require(${JSON.stringify(output)})({}).then(()=>{})`],{stdio:'inherit'});
} finally {fs.rmSync(dir,{recursive:true,force:true});}
