// Browser frame for the client loop. Scene_Dispatch is what WinMain calls:
// splash, login, character select, the loading banner, and the world.

#include <emscripten/emscripten.h>
#include <emscripten/html5.h>

#include "stdafx.h"
#include "Core/Window.h"
#include "Config/Config.h"
#include "Config/ServerConfig.h"
#include "Config/UserSettings.h"
#include "Net/Network.h"
#include "Net/MuEmu.h"
#include "Sound/SoundManager.h"
#include "Scene/Scene_Dispatch.h"
#include "Scene/Scene_Login.h"
#include "UI/ChatListBox.h"
#include "Item/ItemDefines.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

// WinMain.cpp is not linked into the browser client. Keep its lifecycle
// entry points available to the shared window procedure and scene dispatcher.
void __cdecl FreeDirectSound(void);
void OpenGL_Release(void)
{
    FreeDirectSound();
    gWindow.ReleaseOpenGL();
}

void GameGuard_TickCheck(void) {}

extern "C" short Mu_AsyncKeyState[256] = {};
extern "C" void mu_mesh_flush(void);
extern "C" void* ChatListBox_ConstructWhisper(void);
extern "C" void HUD_InitInventoryPools(void);
void __fastcall Quest_FullInit(void* quest);
int SceneFlag = 1;

extern "C" {
void glPushAttrib(unsigned int) {}
void glPopAttrib(void) {}
void glDeleteLists(unsigned int, int) {}
unsigned int glGenLists(int) { return 0; }
void glListBase(unsigned int) {}
void glRasterPos2f(float, float) {}
void glCallLists(int, unsigned int, const void*) {}
void glBitmap(int, int, float, float, float, float, const unsigned char*) {}
}

extern "C" void DbgLogPublic(const char* msg) {
    printf("DBG %s\n", msg ? msg : "");
}

static int g_frames = 0;
static int g_rightRelease = 0;
static int g_leftRelease = 0;
extern "C" void mu_lbutton(int down);
extern "C" int mu_get_auto_attack(void);

void Input_OnWindowMessage(UINT uMsg, WPARAM wParam, LPARAM lParam);

static void displayed_size(int* w, int* h) {
    int vw = EM_ASM_INT({ return Module._viewW | 0; });
    int vh = EM_ASM_INT({ return Module._viewH | 0; });
    if (vw < 1) vw = (int)gWindow.GetWidth();
    if (vh < 1) vh = (int)gWindow.GetHeight();
    if (vw < 1) vw = 640;
    if (vh < 1) vh = 480;
    *w = vw;
    *h = vh;
}

static void note_mouse(const EmscriptenMouseEvent* e) {
    if (!e) return;
    // targetX is a CSS pixel on the fitted canvas. Hit tests stay in the
    // 640x480 layout, so divide by the size on screen, not the render buffer.
    int vw = 0, vh = 0;
    displayed_size(&vw, &vh);
    DAT_083a427c = ((DWORD)e->targetX * 640) / (DWORD)vw;
    DAT_083a4278 = ((DWORD)e->targetY * 480) / (DWORD)vh;
}

static EM_BOOL on_move(int, const EmscriptenMouseEvent* e, void*) {
    note_mouse(e);
    return EM_FALSE;
}

static EM_BOOL on_click(int, const EmscriptenMouseEvent* e, void*) {
    if (!e || e->button != 0) return EM_FALSE;
    // The click event follows mouseup. Mousedown already armed one edge, and
    // a second edge on the next frame toggled the same option straight back.
    note_mouse(e);
    return EM_TRUE;
}

static EM_BOOL on_button(int type, const EmscriptenMouseEvent* e, void*) {
    if (!e) return EM_FALSE;
    // Left button has to stay down until the frame reads it. The options
    // pages ask for both the held button and the click edge; the click
    // event only sets the edge, so those pages never opened.
    if (e->button == 0) {
        note_mouse(e);
        mu_lbutton(type == EMSCRIPTEN_EVENT_MOUSEDOWN ? 1 : 0);
        return EM_TRUE;
    }
    if (e->button != 2) return EM_FALSE;
    if (mu_get_auto_attack()) return EM_TRUE;
    note_mouse(e);
    if (type == EMSCRIPTEN_EVENT_MOUSEDOWN) {
        g_rightRelease = 0;
        Input_OnWindowMessage(WM_RBUTTONDOWN, 0, 0);
    } else {
        // Mouseup can arrive before the next frame. Leave the press visible
        // for one tick, then release it.
        g_rightRelease = 1;
    }
    return EM_TRUE;
}

static unsigned char key_char(const EmscriptenKeyboardEvent* e) {
    if (!e || !e->key[0]) return 0;
    if (strcmp(e->key, "Backspace") == 0) return 8;
    if (strcmp(e->key, "Tab") == 0) return 9;
    if (strcmp(e->key, "Enter") == 0) return 0x0D;
    unsigned char c0 = (unsigned char)e->key[0];
    unsigned char c1 = (unsigned char)e->key[1];
    if (c0 >= 0x20 && c0 < 0x80 && c1 == 0) return c0;
    if ((c0 & 0xE0) == 0xC0 && c1 && e->key[2] == 0) {
        unsigned code = ((c0 & 0x1F) << 6) | (c1 & 0x3F);
        if (code >= 0x20 && code <= 0xFF && code != 0x7F) return (unsigned char)code;
    }
    return 0;
}

static EM_BOOL on_key(int type, const EmscriptenKeyboardEvent* e, void*) {
    if (!e) return EM_FALSE;
    unsigned vk = (unsigned)e->keyCode;
    if (vk < 256)
        Mu_AsyncKeyState[vk] = (type == EMSCRIPTEN_EVENT_KEYDOWN) ? (short)0x8000 : 0;
    if (type != EMSCRIPTEN_EVENT_KEYDOWN) return EM_TRUE;
    unsigned char ch = key_char(e);
    if (!ch) return EM_TRUE;
    Input_OnWindowMessage(WM_CHAR, (WPARAM)ch, 0);
    printf("LOGIN key %02x slot=%u text=%.16s\n", ch, (unsigned)DAT_07e11d78, (char*)DAT_07db8710);
    fflush(stdout);
    return EM_TRUE;
}

// Touch keyboard. down keeps GetAsyncKeyState latched; ch is one WM_CHAR.
extern "C" EMSCRIPTEN_KEEPALIVE void mu_key(int down, int vk, int ch) {
    if (vk >= 0 && vk < 256)
        Mu_AsyncKeyState[vk] = down ? (short)0x8000 : 0;
    if (!down || ch <= 0 || ch > 255) return;
    Input_OnWindowMessage(WM_CHAR, (WPARAM)(unsigned char)ch, 0);
}

// Stick deflection in the 640x480 layout. The client walks while the left
// button is held, toward the ground under the cursor, so the stick holds
// that button and parks the cursor ahead of the hero.
static int g_stickDown = 0;
static int g_leftDown = 0;
static int g_cursorSet = 0;

extern "C" EMSCRIPTEN_KEEPALIVE void mu_stick(int x, int y) {
    if (x > 100) x = 100;
    if (x < -100) x = -100;
    if (y > 100) y = 100;
    if (y < -100) y = -100;
    int ax = x < 0 ? -x : x;
    int ay = y < 0 ? -y : y;
    if (ax < 15 && ay < 15) {
        if (g_stickDown) {
            g_stickDown = 0;
            Input_OnWindowMessage(WM_LBUTTONUP, 0, 0);
        }
        return;
    }
    int mx = 320 + x;
    int my = 240 + y;
    if (mx < 40) mx = 40;
    if (mx > 600) mx = 600;
    // Stay on the ground view: the top is sky, the bottom is the HUD.
    if (my < 90) my = 90;
    if (my > 330) my = 330;
    DAT_083a427c = (DWORD)mx;
    DAT_083a4278 = (DWORD)my;
    g_cursorSet = 0;
    if (!g_stickDown || DAT_083a42c4 == 0) {
        g_stickDown = 1;
        Input_OnWindowMessage(WM_LBUTTONDOWN, 0, 0);
    }
}

// Hold, same as a real right button: the attack runs while it is down.
extern "C" EMSCRIPTEN_KEEPALIVE void mu_rbutton(int down) {
    if (down) {
        if (!g_stickDown && !g_cursorSet) {
            DAT_083a427c = 320;
            DAT_083a4278 = 240;
        }
        g_rightRelease = 0;
        Input_OnWindowMessage(WM_RBUTTONDOWN, 0, 0);
    } else {
        g_rightRelease = 1;
    }
}

// Auto-attack mode: cursor in center (320, 240) and right click active
static int g_autoAttack = 0;

extern "C" EMSCRIPTEN_KEEPALIVE void mu_auto_attack(int enable) {
    g_autoAttack = enable ? 1 : 0;
    if (g_autoAttack) {
        DAT_083a427c = 320;
        DAT_083a4278 = 240;
        g_cursorSet = 1;
        g_rightRelease = 0;
        Input_OnWindowMessage(WM_RBUTTONDOWN, 0, 0);
    } else {
        g_rightRelease = 1;
    }
}

extern "C" EMSCRIPTEN_KEEPALIVE int mu_get_auto_attack(void) {
    return g_autoAttack;
}

// Free cursor for a controller's right stick. 640x480 layout, no button.
extern "C" EMSCRIPTEN_KEEPALIVE void mu_cursor(int x, int y) {
    if (g_stickDown) return;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x > 639) x = 639;
    if (y > 479) y = 479;
    DAT_083a427c = (DWORD)x;
    DAT_083a4278 = (DWORD)y;
    g_cursorSet = 1;
}

// Page or canvas lost focus: master gain only. Levels in Config.ini stay.
extern "C" EMSCRIPTEN_KEEPALIVE void mu_audible(int on) {
    gSound.SetAudible(on != 0);
}

// Left click for menus. The walk stick owns the left button while it is held.
extern "C" EMSCRIPTEN_KEEPALIVE void mu_lbutton(int down) {
    if (g_stickDown) return;
    if (down) {
        if (g_leftDown) return;
        g_leftDown = 1;
        g_leftRelease = 0;
        Input_OnWindowMessage(WM_LBUTTONDOWN, 0, 0);
    } else if (g_leftDown) {
        g_leftDown = 0;
        g_leftRelease = 1;
    }
}

static void install_draw_fix(void) {
    EM_ASM({
        if (Module._wrapDraws) return;
        Module._wrapDraws = 1;
        // These two queries stall the GPU. The limit never changes, and a
        // buffer's size changes only when that buffer is reallocated.
        // Immediate draws bind the temp buffer through the raw WebGL call,
        // which does not fill currentArrayBufferBinding, so remember it here.
        var maxAttribs = GLctx.getParameter(GLctx.MAX_VERTEX_ATTRIBS) | 0;
        var lastArrayBuffer = null;
        var bufSizes = new WeakMap();
        var bindBuffer = GLctx.bindBuffer;
        GLctx.bindBuffer = function(target, buffer) {
            if (target === GLctx.ARRAY_BUFFER) lastArrayBuffer = buffer;
            return bindBuffer.apply(this, arguments);
        };
        function bufferBytes(buf) {
            var hit = bufSizes.get(buf);
            if (hit !== undefined) return hit;
            var sz = GLctx.getBufferParameter(GLctx.ARRAY_BUFFER, GLctx.BUFFER_SIZE) | 0;
            bufSizes.set(buf, sz);
            return sz;
        }
        var bufferData = GLctx.bufferData;
        GLctx.bufferData = function(target, data, usage) {
            var r = bufferData.apply(this, arguments);
            if (target === GLctx.ARRAY_BUFFER && lastArrayBuffer)
                bufSizes.delete(lastArrayBuffer);
            return r;
        };
        var a = GLctx.drawArrays;
        var muAttribIds = new Int32Array(4);
        GLctx.drawArrays = function(mode, first, count) {
            var prev = lastArrayBuffer;
            var imm = (typeof GLImmediate !== 'undefined') ? GLImmediate : null;
            if (imm && imm.clientAttributes && imm.enabledClientAttributes && prev) {
                var strideNow = imm.stride | 0;
                muAttribIds[0] = imm.VERTEX;
                muAttribIds[1] = imm.NORMAL;
                muAttribIds[2] = imm.COLOR;
                muAttribIds[3] = imm.TEXTURE0;
                var bsizeNow = bufferBytes(prev);
                for (var k = 0; k < 4; k++) {
                    var idx = muAttribIds[k];
                    if (idx < 0 || idx >= maxAttribs) continue;
                    var attr = imm.clientAttributes[idx];
                    if (!imm.enabledClientAttributes[idx]) {
                        GLctx.disableVertexAttribArray(idx);
                        continue;
                    }
                    if (!attr || !attr.size || strideNow <= 0) continue;
                    var bytes = attr.sizeBytes | 0;
                    if (!bytes) bytes = 4;
                    var needNow = (attr.offset | 0) + (count > 0 ? (count - 1) * strideNow : 0) + bytes;
                    if (needNow > bsizeNow) {
                        GLctx.disableVertexAttribArray(idx);
                        continue;
                    }
                    GLctx.enableVertexAttribArray(idx);
                    GLctx.vertexAttribPointer(idx, attr.size, attr.type,
                        idx === imm.COLOR || idx === imm.NORMAL, strideNow, attr.offset);
                }
            }
            return a.apply(this, arguments);
        };
        // Mesh draws supply texcoords while the fixed-function unit is off,
        // so the body and the character-select frame stay flat black/gray.
        // Turn the unit on before the batch's shader is chosen.
        if (typeof GLImmediate !== 'undefined' && GLImmediate.flush && !GLImmediate._muTexFlush) {
            GLImmediate._muTexFlush = GLImmediate.flush;
            GLImmediate.flush = function() {
                var texAttr = GLImmediate.TEXTURE0;
                var on = GLImmediate.enabledClientAttributes && GLImmediate.enabledClientAttributes[texAttr];
                if (on && GLImmediate.TexEnvJIT && GLImmediate.TexEnvJIT.getTexUnitType(0) == 0)
                    GLImmediate.TexEnvJIT.hook_enable(0x0DE1);
                return GLImmediate._muTexFlush.apply(this, arguments);
            };
        }
    });
}

static void apply_query_pass(void);
static void sync_page_size(void);

static void frame(void) {
    emscripten_webgl_make_context_current(
        (EMSCRIPTEN_WEBGL_CONTEXT_HANDLE)(intptr_t)gWindow.GetGLContext());
    sync_page_size();
    EM_ASM({
        if (typeof GLImmediate !== 'undefined' && !GLImmediate.matrixVersion) {
            Browser.useWebGL = true;
            GLImmediate.init();
        }
    });
    install_draw_fix();

    int before = SceneFlag;
    int sub = LoginSubState;
    if (g_autoAttack) {
        DAT_083a427c = 320;
        DAT_083a4278 = 240;
        g_cursorSet = 1;
        g_rightRelease = 0;
        if ((g_frames % 6) == 0) {
            Input_OnWindowMessage(WM_RBUTTONDOWN, 0, 0);
        }
    }
    Scene_Dispatch((HDC)1);
    apply_query_pass();
    mu_mesh_flush();

    if (SceneFlag != before || LoginSubState != sub) {
        printf("LOGIN frame=%d flag=%d sub=%d y=%d\n",
               g_frames, SceneFlag, LoginSubState, DAT_005616a4);
    }
    g_frames++;
    if (g_rightRelease) {
        g_rightRelease = 0;
        Input_OnWindowMessage(WM_RBUTTONUP, 0, 0);
    }
    if (g_leftRelease) {
        g_leftRelease = 0;
        Input_OnWindowMessage(WM_LBUTTONUP, 0, 0);
    }
}

static int page_extent(int height_axis) {
    return EM_ASM_INT({
        var dpr = window.devicePixelRatio || 1;
        if (!(dpr > 0)) dpr = 1;
        var bar = document.getElementById('muTopBar');
        var topH = (bar && bar.offsetHeight) ? bar.offsetHeight : 40;
        var css = $0 ? Math.max(100, window.innerHeight - topH) : window.innerWidth;
        var n = Math.round(css * dpr);
        var floor = $0 ? 480 : 640;
        if (n < floor) n = floor;
        if (n & 1) n = n - 1;
        return n;
    }, height_axis);
}

static void apply_page_size(void) {
    // Config.ini stays 1280x720 for the desktop client. The browser draws
    // at the page itself, one game pixel per screen pixel.
    int w = page_extent(0);
    int h = page_extent(1);
    gWindow.SetResolution((DWORD)w, (DWORD)h);
    printf("LOGIN page %dx%d\n", w, h);
    fflush(stdout);
}

static void size_canvas(int w, int h) {
    EM_ASM({
        var c = Module.canvas;
        var bar = document.getElementById('muTopBar');
        var topH = (bar && bar.offsetHeight) ? bar.offsetHeight : 40;
        var availH = Math.max(100, window.innerHeight - topH);
        c.width = $0;
        c.height = $1;
        c.style.position = 'fixed';
        c.style.width = window.innerWidth + 'px';
        c.style.height = availH + 'px';
        c.style.left = '0px';
        c.style.top = topH + 'px';
        c.style.imageRendering = 'pixelated';
        c.style.outline = 'none';
        c.style.border = '0';
        Module._viewW = window.innerWidth;
        Module._viewH = availH;
        if (!Module._pageResizeHook) {
            Module._pageResizeHook = 1;
            window.addEventListener('resize', function () { Module._pageDirty = 1; });
        }
    }, w, h);
}

static void sync_page_size(void) {
    int dirty = EM_ASM_INT({ return Module._pageDirty ? 1 : 0; });
    if (!dirty) return;
    EM_ASM({ Module._pageDirty = 0; });
    int w = page_extent(0);
    int h = page_extent(1);
    if (w == (int)gWindow.GetWidth() && h == (int)gWindow.GetHeight()) return;
    gWindow.SetResolution((DWORD)w, (DWORD)h);
    size_canvas(w, h);
}

// Phone, or a window as narrow as the touch keyboard. Antilag is chosen
// once at start. The render size follows a later page resize on its own.
static int mobile_low(void) {
    return EM_ASM_INT({
        var coarse = false;
        try { coarse = window.matchMedia("(pointer: coarse)").matches; } catch (e) {}
        return (coarse || window.innerWidth <= 900) ? 1 : 0;
    });
}

static void apply_mobile_low(void) {
    // Disabled: previous mobile preset forcibly disabled ANTILAG_SKILLS (e.g. Evil Spirit),
    // ANTILAG_STATIC_EFFECTS, ANTILAG_DYNAMIC_EFFECTS (monster transparent textures/particles),
    // ANTILAG_WINGS, and ANTILAG_GLOW.
}

// ?u=account&p=password fills the login fields. Both are capped at 10,
// which is what the 0.97k account box accepts.
static char g_qUser[11];
static char g_qPass[11];
static int g_qPassArmed;

static void read_login_query(void) {
    EM_ASM({
      try {
        function param(name) {
            var q = location.search.length > 1 ? location.search.substring(1) : "";
            var parts = q.split("&");
            for (var i = 0; i < parts.length; i++) {
                var cut = parts[i].indexOf("=");
                var key = decodeURIComponent(cut < 0 ? parts[i] : parts[i].substring(0, cut));
                if (key !== name) continue;
                var val = cut < 0 ? "" : parts[i].substring(cut + 1);
                try { return decodeURIComponent(val.split("+").join(" ")); }
                catch (e) { return ""; }
            }
            return "";
        }
        function put(text, ptr) {
            var n = 0;
            for (var i = 0; i < text.length && n < 10; i++) {
                var c = text.charCodeAt(i);
                if (c < 33 || c > 126) continue;
                HEAPU8[ptr + n] = c;
                n++;
            }
            HEAPU8[ptr + n] = 0;
        }
        put(param("u") || param("user"), $0);
        put(param("p") || param("pass"), $1);
      } catch (e) {}
    }, g_qUser, g_qPass);
    if (g_qUser[0])
        lstrcpynA((char*)lpData_055c9ba0, g_qUser, 11);
    g_qPassArmed = g_qPass[0] ? 1 : 0;
}

static void apply_query_pass(void) {
    if (!g_qPassArmed || InputNumber != 2) return;
    char* pass = (char*)DAT_07db8710 + 0x100;
    lstrcpynA(pass, g_qPass, 11);
    ((DWORD*)DAT_07d780a8)[1] = (DWORD)strlen(pass);
    g_qPassArmed = 0;
}

int main(void) {
    printf("LOGIN start\n");
    fflush(stdout);
    // Config.ini from the desktop client: language, font, sound, resolution.
    // The address stays local even though ServerConfig.h names the public host.
    Config_Load();
    apply_mobile_low();
    apply_page_size();
    // The desktop exe's version resource is 0.97.11, which the client prints
    // as 0.97k. The browser has no such resource and Config.ini has no
    // [LOGIN] Version, so the footer was "Version:  - by ...".
    if (!ConfigLoginVersion[0])
        lstrcpynA(ConfigLoginVersion, "0.97k", sizeof(ConfigLoginVersion));
    read_login_query();
    {
        extern char g_ServerIPBuf[128];
        unsigned short port = 0;
        Config_ReadServerAddr(NULL, NULL, g_ServerIPBuf, &port);
        lstrcpynA(g_ServerIPBuf, "127.0.0.1", 128);
        szServerIpAddress = g_ServerIPBuf;
        g_ServerPort = 55901;
        gNetwork.SetConnectServer(false); // Solo offline mode: direct to in-memory GameServer
        MuEmu::SetActive(false); // Solo offline mode uses raw standard MU packets
        printf("LOGIN local %s:%u lang=%d font=%d res=%ux%u\n",
               szServerIpAddress, (unsigned)g_ServerPort,
               gUserSettings.GetLanguage(), gUserSettings.GetFont().height,
               gWindow.GetWidth(), gWindow.GetHeight());
        fflush(stdout);
    }
    size_canvas((int)gWindow.GetWidth(), (int)gWindow.GetHeight());
    if (!gWindow.InitOpenGL()) {
        printf("LOGIN init_failed\n");
        return 1;
    }

    OpenTextData();
    // Text.bmd says "kayito". The footer on the desktop server list is "kavito".
    {
        char* credit = strstr(GlobalText[456], "kayito");
        if (credit) memcpy(credit, "kavito", 6);
    }
    printf("LOGIN ver '%s' fmt '%.48s'\n", ConfigLoginVersion, GlobalText[456]);
    fflush(stdout);
    extern BOOL __cdecl CSimpleModulus_LoadEncryptionKey(DWORD* self, const char* fn);
    extern BOOL __cdecl CSimpleModulus_LoadDecryptionKey(DWORD* self, const char* fn);
    BOOL okEnc = CSimpleModulus_LoadEncryptionKey(g_SimpleModulusCS, "Data\\Enc1.dat");
    BOOL okDec = CSimpleModulus_LoadDecryptionKey(g_SimpleModulusSC, "Data\\Dec2.dat");
    printf("LOGIN keys enc=%d dec=%d\n", (int)okEnc, (int)okDec);
    fflush(stdout);
    gFont.Create(gWindow.GetWidth());
    gFont.CreateTextSurface((HDC)1, 256, 32);
    if (GlobalText[450][0] == 0) strcpy(GlobalText[450], "Account");
    if (GlobalText[451][0] == 0) strcpy(GlobalText[451], "Password");
    if (lpString_07d4aed4[0] == 0) strcpy(lpString_07d4aed4, "OK");
    if (lpString_07d4b000[0] == 0) strcpy(lpString_07d4b000, "Cancel");

    // ── 6 Solo Difficulty Realms (Classic + FUN) ─────────────────────────────
    memset(DAT_083a45d8, 0, sizeof(DAT_083a45d8));
    ServerSelectHi = (DWORD)-1;
    ServerSelectLo = (DWORD)-1;

    // 🟢 Realm 0: Easy (300x EXP, High Drops, Reset Lvl 300)
    char* srv0 = DAT_083a45d8 + 0 * 0x21e;
    memcpy(srv0, "Arcadia [Easy]", 15);
    srv0[0x14] = 1;                         // 1 channel
    *(unsigned short*)(srv0 + 0x2c) = 0;   // channel_id 0 (Easy)
    srv0[0x2e] = 25;                       // load 25% (green)

    // 🟡 Realm 1: Medium (100x EXP, Classic Rates, Reset Lvl 400)
    char* srv1 = DAT_083a45d8 + 1 * 0x21e;
    memcpy(srv1, "Valhalla [Medium]", 18);
    srv1[0x14] = 1;                         // 1 channel
    *(unsigned short*)(srv1 + 0x2c) = 1;   // channel_id 1 (Medium)
    srv1[0x2e] = 50;                       // load 50% (green)

    // 🔴 Realm 2: Hard (30x EXP, Hardcore, Low Drops, Reset Lvl 400)
    char* srv2 = DAT_083a45d8 + 2 * 0x21e;
    memcpy(srv2, "Asgard [Hard]", 14);
    srv2[0x14] = 1;                         // 1 channel
    *(unsigned short*)(srv2 + 0x2c) = 2;   // channel_id 2 (Hard)
    srv2[0x2e] = 75;                       // load 75% (green)

    // 🟣 Realm 3: Easy FUN (300x EXP, Top Gear, Wings & Kundun Boxes in Shops)
    char* srv3 = DAT_083a45d8 + 3 * 0x21e;
    memcpy(srv3, "Elysium [Easy FUN]", 19);
    srv3[0x14] = 1;                         // 1 channel
    *(unsigned short*)(srv3 + 0x2c) = 3;   // channel_id 3 (Easy FUN)
    srv3[0x2e] = 25;                       // load 25% (green)

    // 🟣 Realm 4: Medium FUN (100x EXP, Top Gear, Wings & Kundun Boxes in Shops)
    char* srv4 = DAT_083a45d8 + 4 * 0x21e;
    memcpy(srv4, "Olympus [Med FUN]", 18);
    srv4[0x14] = 1;                         // 1 channel
    *(unsigned short*)(srv4 + 0x2c) = 4;   // channel_id 4 (Medium FUN)
    srv4[0x2e] = 50;                       // load 50% (green)

    // 🟣 Realm 5: Hard FUN (30x EXP, Top Gear, Wings & Kundun Boxes in Shops)
    char* srv5 = DAT_083a45d8 + 5 * 0x21e;
    memcpy(srv5, "Atlantis [Hard FUN]", 20);
    srv5[0x14] = 1;                         // 1 channel
    *(unsigned short*)(srv5 + 0x2c) = 5;   // channel_id 5 (Hard FUN)
    srv5[0x2e] = 75;                       // load 75% (green)

    // WinMain fills RandomTable before anything else calls rand(). The browser
    // never enters WinMain, so the table stayed zero and every Zen coin of a
    // pile was placed on the same point.
    srand((unsigned int)time(NULL));
    for (int j = 0; j < 100; ++j)
        RandomTable[j] = rand() % 360;

    GateAttribute = (DWORD)(uintptr_t)calloc(1, 900);
    DAT_07d29d20 = (int)(intptr_t)calloc(1, 0xa00);
    DAT_07cf1ff8 = (int)(intptr_t)calloc(1, 0xa00);
    DAT_055c9e44 = (DWORD)(uintptr_t)malloc((ITEM_MAX_EX + 0x400) * 0x40);
    DAT_07d78068 = DAT_055c9e44 + (rand() % 0x400) * 0x40;
    memset((void*)(uintptr_t)DAT_07d78068, 0, ITEM_MAX_EX * 0x40);
    DAT_07cf1ff0 = (int)(intptr_t)calloc(1, 0x8000);

    DAT_055c9e48 = (DWORD)(uintptr_t)malloc(0x764d4);
    DAT_07abf5d0 = DAT_055c9e48 + (rand() % 0x80) * 0x394;
    memset((void*)(uintptr_t)DAT_07abf5d0, 0, 0x166b5 * 4);
    Hero = (char*)(uintptr_t)DAT_07abf5d0;
    DAT_07abf5d8 = (char*)(uintptr_t)DAT_07abf5d0;

    void* ht = calloc(1, 0x584);
    DAT_07cf1ffc = ht;
    DAT_07cf1ff4 = ht;
    extern void* CharacterMachine;
    CharacterMachine = ht;
    extern void __cdecl PathContext_Create(void);
    PathContext_Create();
    DAT_055c9ff0 = (DWORD)(uintptr_t)ChatListBox_Construct();
    DAT_055c9ff4 = (DWORD)(uintptr_t)ChatListBox_ConstructWhisper();
    HUD_InitInventoryPools();
    DAT_055c9ff8 = (DWORD)(uintptr_t)calloc(1, 0xc);
    void* quest = calloc(1, 0x1c900);
    Quest_FullInit(quest);

    InitDirectSound((HWND)1);
    gSound.SetLevels(gUserSettings.GetSoundLevel(), gUserSettings.GetMusicLevel());
    LoadWaveFile(4, "Data/Sound/iTitle.wav", 1, 0);
    LoadWaveFile(0x19, "Data/Sound/iButtonClick.wav", 1, 0);
    LoadWaveFile(0x1b, "Data/Sound/iButtonMove.wav", 2, 0);
    LoadWaveFile(0x1a, "Data/Sound/iButtonError.wav", 1, 0);
    LoadWaveFile(0x1c, "Data/Sound/iCreateWindow.wav", 1, 0);

    SceneFlag = 1;
    LoginSubState = 0;
    emscripten_set_mousemove_callback("#canvas", 0, 1, on_move);
    emscripten_set_mousedown_callback("#canvas", 0, 1, on_button);
    emscripten_set_mouseup_callback("#canvas", 0, 1, on_button);
    emscripten_set_click_callback("#canvas", 0, 1, on_click);
    emscripten_set_keydown_callback(EMSCRIPTEN_EVENT_TARGET_WINDOW, 0, 1, on_key);
    emscripten_set_keyup_callback(EMSCRIPTEN_EVENT_TARGET_WINDOW, 0, 1, on_key);
    printf("LOGIN loop label450=%.24s\n", GlobalText[450]);
    fflush(stdout);
    emscripten_set_main_loop(frame, 0, 1);
    return 0;
}
