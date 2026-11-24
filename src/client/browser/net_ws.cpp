// Browser in-memory transport bridge for MU Online Solo Classic (0.97k).
// Replaces external WebSocket network calls with a direct in-memory message channel
// connecting client WebAssembly engine to in-browser GameServer Web Worker.

#include <emscripten/emscripten.h>

#include "stdafx.h"
#include "Net/Network.h"
#include "Net/MuEmu.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int g_open = 0;
static int g_err = 0;
static char g_host[128] = "127.0.0.1";
static unsigned char* g_in = 0;
static int g_in_cap = 0;
static int g_in_len = 0;
static int g_sends = 0;

static void note_host(const char* s) {
    if (!s || !s[0]) return;
    strncpy(g_host, s, sizeof(g_host) - 1);
    g_host[sizeof(g_host) - 1] = 0;
}

static void post_event(unsigned evt) {
    gNetwork.OnSocketEvent((WORD)evt, 0);
}

static int append_in(const unsigned char* data, int n) {
    if (n <= 0) return 1;
    if (g_in_len > 0x4000000 || n > 0x4000000) {
        printf("SOLO: recv overflow\n");
        fflush(stdout);
        return 0;
    }
    if (g_in_len + n > g_in_cap) {
        int cap = g_in_cap > 0 ? g_in_cap : 65536;
        while (cap < g_in_len + n) {
            if (cap > 0x2000000) {
                cap = g_in_len + n;
                break;
            }
            cap *= 2;
        }
        unsigned char* grown = (unsigned char*)realloc(g_in, (size_t)cap);
        if (!grown) {
            printf("SOLO: recv overflow\n");
            fflush(stdout);
            return 0;
        }
        g_in = grown;
        g_in_cap = cap;
    }
    memcpy(g_in + g_in_len, data, (size_t)n);
    g_in_len += n;
    return 1;
}

// Windows posts FD_READ again while bytes remain. One call here reads 8 KB
// and returns, so keep going until this message is in the client buffer.
static void drain_in() {
    for (int i = 0; i < 8192 && g_in_len > 0; ++i) {
        int before = g_in_len;
        post_event(FD_READ);
        if (g_in_len >= before) break;
    }
}

static unsigned char g_push_buf[65536];

// Function callable from JS to get buffer pointer for incoming packets
extern "C" EMSCRIPTEN_KEEPALIVE unsigned char* mu_net_get_push_buffer(void) {
    return g_push_buf;
}

// Function callable from JS to push incoming packets from server_worker
extern "C" EMSCRIPTEN_KEEPALIVE void mu_net_push_packet(int len) {
    if (len > 0 && len <= (int)sizeof(g_push_buf)) {
        append_in(g_push_buf, len);
        drain_in();
    }
}

extern "C" EMSCRIPTEN_KEEPALIVE void mu_net_push_bytes(const unsigned char* data, int len) {
    if (data && len > 0) {
        append_in(data, len);
        drain_in();
    }
}

extern "C" int mu_net_last_error(void) { return g_err; }

extern "C" SOCKET mu_net_socket(int, int, int) {
    g_err = 0;
    return (SOCKET)1;
}

extern "C" uint32_t mu_net_inet_addr(const char* s) {
    note_host(s);
    if (!s) return INADDR_NONE;
    unsigned parts[4];
    int n = 0;
    const char* p = s;
    while (*p && n < 4) {
        if (*p < '0' || *p > '9') return INADDR_NONE;
        unsigned v = 0;
        while (*p >= '0' && *p <= '9') {
            v = v * 10u + (unsigned)(*p - '0');
            if (v > 255u) return INADDR_NONE;
            p++;
        }
        parts[n++] = v;
        if (n < 4) {
            if (*p != '.') return INADDR_NONE;
            p++;
        }
    }
    if (n != 4 || *p) return INADDR_NONE;
    return parts[0] | (parts[1] << 8) | (parts[2] << 16) | (parts[3] << 24);
}

extern "C" struct hostent* mu_net_gethostbyname(const char* name) {
    note_host(name);
    static char addr[4] = { 127, 0, 0, 1 };
    static char* list[2] = { addr, 0 };
    static struct hostent h;
    h.h_name = g_host;
    h.h_aliases = 0;
    h.h_addrtype = AF_INET;
    h.h_length = 4;
    h.h_addr_list = list;
    g_err = 0;
    return &h;
}

extern "C" int mu_net_async_select(SOCKET, HWND, unsigned, long) {
    g_err = 0;
    return 0;
}

extern "C" int mu_net_connect(SOCKET, const void* addr, int len) {
    g_open = 0;
    g_in_len = 0;
    g_err = 0;
    MuEmu::SetActive(false);

    int realmMode = (int)ServerSelectHi;
    if (realmMode < 0 || realmMode > 5) realmMode = 0;

    printf("SOLO: in-memory bridge connect realm=%d\n", realmMode);
    fflush(stdout);

    EM_ASM({
        Module['HEAPU8'] = HEAPU8;
        if (typeof window !== 'undefined') {
            window['HEAPU8'] = HEAPU8;
        }
        if (typeof window !== 'undefined' && window.soloBridge && window.soloBridge.connect) {
            window.soloBridge.connect($0);
        }
    }, realmMode);

    g_open = 1;
    post_event(FD_WRITE);
    return 0;
}

extern "C" int mu_net_closesocket(SOCKET) {
    if (g_open) {
        EM_ASM({
            if (typeof window !== 'undefined' && window.soloBridge && window.soloBridge.disconnect) {
                window.soloBridge.disconnect();
            }
        });
    }
    g_open = 0;
    g_in_len = 0;
    g_err = 0;
    return 0;
}

extern "C" EMSCRIPTEN_KEEPALIVE void mu_net_push_disconnect(void) {
    if (g_open) {
        g_open = 0;
        g_in_len = 0;
        g_err = 0;
        post_event(FD_CLOSE);
    }
}


extern "C" int mu_net_send(SOCKET, const char* buf, int len, int) {
    if (!g_open) {
        g_err = WSAEWOULDBLOCK;
        return -1;
    }
    if (len <= 0) return 0;

    EM_ASM({
        if (typeof window !== 'undefined' && window.soloBridge && window.soloBridge.send) {
            var data = HEAPU8.subarray($0, $0 + $1);
            window.soloBridge.send(data);
        }
    }, buf, len);

    if (g_sends < 8) {
        printf("SOLO: client sent %d bytes\n", len);
        fflush(stdout);
    }
    g_sends++;
    g_err = 0;
    return len;
}

extern "C" int mu_net_recv(SOCKET, char* buf, int len, int) {
    if (g_in_len <= 0) {
        g_err = WSAEWOULDBLOCK;
        return -1;
    }
    if (!buf || len <= 0) return 0;
    int n = g_in_len < len ? g_in_len : len;
    memcpy(buf, g_in, (size_t)n);
    memmove(g_in, g_in + n, (size_t)(g_in_len - n));
    g_in_len -= n;
    g_err = 0;
    return n;
}
