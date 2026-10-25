/**
 * ============================================================================
 * MU Online Solo Classic - Web Application Controller & Client Bridge
 * ============================================================================
 */

const BUILD_VERSION = window.BUILD_VERSION = 'login102';

// ── 1. Virtual Touch Controls & On-Screen Keyboard ──────────────────────────

window.muInstallKeys = function () {
  var btn = document.getElementById('muKeyBtn');
  var pad = document.getElementById('muKeys');
  if (!btn || !pad || btn._mu) return;
  btn._mu = 1;
  var held = {};

  function send(down, vk, ch) {
    if (typeof Module !== 'undefined' && Module._mu_key)
      Module._mu_key(down ? 1 : 0, vk | 0, down ? (ch | 0) : 0);
  }

  function stop(ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }

  btn.addEventListener('pointerdown', function (ev) {
    stop(ev);
    var open = pad.classList.toggle('on');
    btn.classList.toggle('on', open);
  });

  pad.addEventListener('pointerdown', function (ev) {
    var key = ev.target.closest('button');
    if (!key) return;
    stop(ev);
    if (key.getAttribute('data-lock')) {
      var vk = key.getAttribute('data-lock') | 0;
      var on = !key.classList.contains('lit');
      key.classList.toggle('lit', on);
      send(on, vk, 0);
      return;
    }
    var vk = key.getAttribute('data-vk') | 0;
    var ch = key.getAttribute('data-ch');
    ch = ch == null ? 0 : (ch | 0);
    if (ch >= 97 && ch <= 122 && pad.querySelector('[data-lock="16"].lit')) ch -= 32;
    send(1, vk, ch);
    var rep = 0;
    if (ch) {
      rep = setTimeout(function tick() {
        var h = held[ev.pointerId];
        if (!h) return;
        send(1, vk, ch);
        h.timer = setTimeout(tick, 45);
      }, 420);
    }
    held[ev.pointerId] = { vk: vk, timer: rep };
    key.setPointerCapture(ev.pointerId);
  });

  function release(ev) {
    var h = held[ev.pointerId];
    if (!h) return;
    clearTimeout(h.timer);
    send(0, h.vk, 0);
    delete held[ev.pointerId];
  }

  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);

  window.addEventListener('blur', function () {
    Object.keys(held).forEach(function (id) {
      clearTimeout(held[id].timer);
      send(0, held[id].vk, 0);
    });
    held = {};
  });
};

window.muInstallTouch = function () {
  var stick = document.getElementById('muStick');
  var knob = document.getElementById('muStickKnob');
  var rbtn = document.getElementById('muRBtn');
  if (!stick || stick._mu) return;
  stick._mu = 1;
  var radius = 40;
  var lastX = 0, lastY = 0, timer = 0, pid = -1;

  function stickSend() {
    if (typeof Module !== 'undefined' && Module._mu_stick)
      Module._mu_stick(lastX | 0, lastY | 0);
  }

  function place(ev) {
    var box = stick.getBoundingClientRect();
    var dx = ev.clientX - (box.left + box.width / 2);
    var dy = ev.clientY - (box.top + box.height / 2);
    var len = Math.sqrt(dx * dx + dy * dy);
    var kx = 0, ky = 0;
    lastX = 0;
    lastY = 0;
    if (len > 8) {
      var clamped = Math.min(len, radius);
      var s = clamped / len;
      kx = dx * s;
      ky = dy * s;
      lastX = Math.round((dx / len) * (clamped / radius) * 100);
      lastY = Math.round((dy / len) * (clamped / radius) * 100);
    }
    knob.style.transform = 'translate(' + kx + 'px,' + ky + 'px)';
    stickSend();
  }

  function arm() {
    if (timer) return;
    timer = setInterval(stickSend, 40);
  }

  function disarm() {
    lastX = 0;
    lastY = 0;
    knob.style.transform = '';
    stickSend();
    if (timer) { clearInterval(timer); timer = 0; }
    pid = -1;
  }

  stick.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    pid = ev.pointerId;
    place(ev);
    arm();
    try { stick.setPointerCapture(ev.pointerId); } catch (e) { }
  });

  stick.addEventListener('pointermove', function (ev) {
    if (ev.pointerId !== pid) return;
    ev.preventDefault();
    place(ev);
  });

  stick.addEventListener('pointerup', function (ev) {
    if (ev.pointerId !== pid) return;
    ev.preventDefault();
    disarm();
  });

  stick.addEventListener('pointercancel', disarm);

  if (rbtn && !rbtn._mu) {
    rbtn._mu = 1;
    var rpid = -1;

    function rsend(down) {
      if (typeof Module !== 'undefined' && Module._mu_rbutton)
        Module._mu_rbutton(down ? 1 : 0);
    }

    rbtn.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      rpid = ev.pointerId;
      rbtn.classList.add('on');
      rsend(1);
      try { rbtn.setPointerCapture(ev.pointerId); } catch (e) { }
    });

    function rlift(ev) {
      if (ev && ev.pointerId !== rpid) return;
      rbtn.classList.remove('on');
      rsend(0);
      rpid = -1;
    }

    rbtn.addEventListener('pointerup', rlift);
    rbtn.addEventListener('pointercancel', rlift);
  }

  window.addEventListener('blur', function () {
    disarm();
    if (rbtn) {
      rbtn.classList.remove('on');
      if (typeof Module !== 'undefined' && Module._mu_rbutton) Module._mu_rbutton(0);
    }
  });
};

// ── 2. Gamepad / Steam Deck Controller Support ─────────────────────────────
// PC gamepads and the Steam Deck controls share the standard mapping:
// left stick walks, right stick moves the cursor, RT/RB holds the right
// button, A holds the left button, B and Back are Esc, Start is Enter.

window.muInstallPad = function () {
  if (window._muPad) return;
  window._muPad = 1;
  var cursor = { x: 320, y: 240 };
  var latched = {};
  var stickOn = 0, rDown = 0, lDown = 0, seen = 0;

  function call(name, args) {
    var fn = (typeof Module !== 'undefined') ? Module[name] : null;
    if (fn) fn.apply(null, args);
  }

  function setKey(name, down, vk, ch) {
    if (down && !latched[name]) { latched[name] = vk; call('_mu_key', [1, vk, ch || 0]); }
    if (!down && latched[name]) { var vk0 = latched[name]; latched[name] = 0; call('_mu_key', [0, vk0, 0]); }
  }

  function releaseAll() {
    if (stickOn) { stickOn = 0; call('_mu_stick', [0, 0]); }
    if (rDown) { rDown = 0; call('_mu_rbutton', [0]); }
    if (lDown) { lDown = 0; call('_mu_lbutton', [0]); }
    Object.keys(latched).forEach(function (name) { setKey(name, 0, 0, 0); });
  }

  function pressed(pad, i) {
    var b = pad.buttons && pad.buttons[i];
    return !!(b && (b.pressed || b.value > 0.45));
  }

  function axis(pad, i) {
    var v = (pad.axes && pad.axes[i]) || 0;
    return Math.abs(v) < 0.18 ? 0 : v;
  }

  window.muReadPad = function (pad) {
    if (!pad || !pad.connected) { if (seen) releaseAll(); seen = 0; return; }
    seen = 1;
    var lx = axis(pad, 0), ly = axis(pad, 1);
    if (lx || ly) { stickOn = 1; call('_mu_stick', [Math.round(lx * 100), Math.round(ly * 100)]); }
    else if (stickOn) { stickOn = 0; call('_mu_stick', [0, 0]); }
    var rx = axis(pad, 2), ry = axis(pad, 3);
    if (!stickOn && (rx || ry)) {
      cursor.x = Math.max(0, Math.min(639, cursor.x + rx * 14));
      cursor.y = Math.max(0, Math.min(479, cursor.y + ry * 14));
      call('_mu_cursor', [cursor.x | 0, cursor.y | 0]);
    }
    var attack = pressed(pad, 7) || pressed(pad, 5);
    if (attack !== !!rDown) { rDown = attack ? 1 : 0; call('_mu_rbutton', [rDown]); }
    var south = pressed(pad, 0);
    if (!stickOn && south !== !!lDown) { lDown = south ? 1 : 0; call('_mu_lbutton', [lDown]); }
    if (stickOn && lDown) { lDown = 0; call('_mu_lbutton', [0]); }
    setKey('up', pressed(pad, 12), 38, 0);
    setKey('down', pressed(pad, 13), 40, 0);
    setKey('left', pressed(pad, 14), 37, 0);
    setKey('right', pressed(pad, 15), 39, 0);
    setKey('b', pressed(pad, 1), 27, 0);
    setKey('back', pressed(pad, 8), 27, 0);
    setKey('start', pressed(pad, 9), 13, 13);
  };

  function tick() {
    var pad = null;
    var list = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].connected) { pad = list[i]; break; }
    }
    window.muReadPad(pad);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
};

// ── 3. WebAudio Management ──────────────────────────────────────────────────

window.muInstallAudio = function () {
  if (window._muAudio) return;
  window._muAudio = 1;
  var canvas = document.getElementById('canvas');

  function sync() {
    // The canvas covers the page, and game clicks swallow the default
    // focus, so the canvas is rarely the active element. Mute only when
    // the tab itself is in the background.
    var on = document.visibilityState === 'visible' && document.hasFocus();
    if (typeof Module !== 'undefined' && Module._mu_audible)
      Module._mu_audible(on ? 1 : 0);
    if (document.visibilityState === 'hidden' && window.soloBridge && window.soloBridge.saveNow) {
      window.soloBridge.saveNow();
    }
  }

  function resume() {
    if (canvas) canvas.focus({ preventScroll: true });
    sync();
    var list = window.miniaudio && window.miniaudio.devices;
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      var device = list[i];
      if (device && device.webaudio && device.webaudio.resume)
        device.webaudio.resume();
    }
  }

  document.addEventListener('mousedown', function (ev) {
    var t = ev.target && ev.target.closest && ev.target.closest('#muKeys, #muStick, #muKeyBtn, #muRBtn');
    if (!t) return;
    ev.preventDefault();
    if (canvas) canvas.focus({ preventScroll: true });
  }, true);

  document.addEventListener('pointerdown', resume, true);
  window.addEventListener('blur', sync);
  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', sync);
  sync();
};

// ── 4. Zero-Network In-Memory Bridge to GameServer Web Worker ───────────────

(function () {
  var worker = null;
  var workerReady = false;
  var currentRealm = 0;
  var pendingConnectRealm = null;
  var incomingQueue = [];

  function getSaveKey(realm) {
    return 'mu_solo_realm_' + (realm !== undefined ? realm : currentRealm) + '_vault';
  }

  function loadSavedContainer(realm) {
    try {
      const raw = localStorage.getItem(getSaveKey(realm));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {
      console.error('[SoloBridge] Failed to load save container:', e);
    }
    return null;
  }

  function deliverPacketToClient(bytes) {
    var heap = null;
    try {
      heap = (typeof window !== 'undefined' && window.HEAPU8) || (typeof Module !== 'undefined' && Module.HEAPU8);
    } catch (e) { }
    if (typeof Module !== 'undefined' && Module._mu_net_push_packet && Module._mu_net_get_push_buffer && heap) {
      const ptr = Module._mu_net_get_push_buffer();
      heap.set(bytes, ptr);
      Module._mu_net_push_packet(bytes.length);
    } else {
      incomingQueue.push(bytes);
    }
  }

  function initServerWorker(difficulty) {
    if (difficulty === undefined) difficulty = 0;
    if (worker) return;
    currentRealm = difficulty;
    console.log('[SoloBridge] Initializing Server Web Worker for difficulty realm:', difficulty);
    worker = new Worker(`server_worker.js?v=${BUILD_VERSION}`);

    worker.onmessage = function (e) {
      const msg = e.data;
      if (!msg) return;

      if (msg.type === 'LOG') {
        console.log(`%c[SoloServer] ${msg.message}`, `color: ${msg.color || '#60a5fa'}`);
      } else if (msg.type === 'SERVER_READY') {
        console.log('[SoloBridge] Solo GameServer is READY! Monsters:', msg.monsters, 'Realm:', msg.difficulty);
        workerReady = true;
        if (window.muUpdateRealmBadge) {
          window.muUpdateRealmBadge(msg.difficulty !== undefined ? msg.difficulty : currentRealm);
        }
        if (pendingConnectRealm !== null) {
          const r = pendingConnectRealm;
          pendingConnectRealm = null;
          window.soloBridge.connect(r);
        }
      } else if (msg.type === 'PACKET_FROM_SERVER') {
        deliverPacketToClient(new Uint8Array(msg.data));
      } else if (msg.type === 'AUTO_SAVE_DATA') {
        if (msg.saves) {
          try {
            localStorage.setItem(getSaveKey(currentRealm), JSON.stringify(msg.saves));
            console.log(`[SoloBridge] Auto-saved vault for realm ${currentRealm}`);
            if (msg.manual && window.muShowToast) {
              window.muShowToast("Game saved successfully!");
            }
          } catch (err) {
            console.error('[SoloBridge] Failed to save vault:', err);
            if (window.muShowToast) window.muShowToast("Failed to save: " + err.message);
          }
        }
      } else if (msg.type === 'SAVE_NOW_COMPLETE') {
        if (msg.saves) {
          try {
            localStorage.setItem(getSaveKey(currentRealm), JSON.stringify(msg.saves));
          } catch (err) {}
        }
        if (window.muShowToast) {
          window.muShowToast(msg.success ? "Game & inventory saved successfully!" : "Game saved.");
        }
      } else if (msg.type === 'SAVES_EXPORTED') {
        if (msg.saves) {
          try {
            localStorage.setItem(getSaveKey(msg.realm !== undefined ? msg.realm : currentRealm), JSON.stringify(msg.saves));
          } catch (err) {}
        }
        if (msg.reason === 'download' && msg.saves) {
          try {
            var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(msg.saves, null, 2));
            var dlAnchor = document.createElement('a');
            dlAnchor.setAttribute("href", dataStr);
            dlAnchor.setAttribute("download", "mu_solo_realm_" + (msg.realm !== undefined ? msg.realm : currentRealm) + "_save.musav");
            document.body.appendChild(dlAnchor);
            dlAnchor.click();
            dlAnchor.remove();
            if (window.muShowToast) window.muShowToast("Save exported successfully!");
          } catch (e) {
            console.error("Export error:", e);
            if (window.muShowToast) window.muShowToast("Failed to export save file.");
          }
        }
      } else if (msg.type === 'PLAYER_CONNECTED') {
        console.log('[SoloBridge] Player connected to GameServer session:', msg.playerIndex);
      } else if (msg.type === 'PLAYER_DISCONNECTED') {
        console.log('[SoloBridge] Player session disconnected on server');
        if (typeof Module !== 'undefined' && Module._mu_net_push_disconnect) {
          Module._mu_net_push_disconnect();
        }
      } else if (msg.type === 'REALM_SWITCHED' || msg.type === 'DIFFICULTY_SET') {
        console.log('[SoloBridge] Realm switched confirmed by worker:', msg.mode);
        if (msg.mode !== undefined) {
          currentRealm = msg.mode;
          if (window.muUpdateRealmBadge) {
            window.muUpdateRealmBadge(msg.mode);
          }
        }
      } else if (msg.type === 'ERROR' || msg.type === 'SAVE_INTEGRITY_ERROR') {
        console.error('[SoloBridge] Server Worker Error:', msg.message, msg.stack);
        if (window.muShowToast) {
          window.muShowToast(`Server warning: ${msg.message}`);
        }
      }
    };

    const existingSaves = loadSavedContainer(difficulty);
    worker.postMessage({
      action: 'INIT',
      payload: {
        saves: existingSaves,
        difficulty: difficulty
      }
    });
  }

  window.soloBridge = {
    flushQueue: function () {
      while (incomingQueue.length > 0) {
        const pkt = incomingQueue.shift();
        deliverPacketToClient(pkt);
      }
    },
    connect: function (realmMode) {
      console.log('[SoloBridge] Client requested GameServer connect for realm:', realmMode);
      if (realmMode === undefined || realmMode === null || realmMode < 0 || realmMode > 5) {
        realmMode = 0;
      }
      currentRealm = realmMode;
      if (window.muUpdateRealmBadge) {
        window.muUpdateRealmBadge(realmMode);
      }
      if (!worker) {
        pendingConnectRealm = realmMode;
        initServerWorker(realmMode);
        return;
      }
      if (!workerReady) {
        pendingConnectRealm = realmMode;
        return;
      }
      const existingSaves = loadSavedContainer(realmMode);
      worker.postMessage({
        action: 'SWITCH_REALM',
        payload: {
          mode: realmMode,
          saves: existingSaves
        }
      });
      worker.postMessage({
        action: 'CONNECT_PLAYER',
        payload: { ip: '127.0.0.1' }
      });
    },
    send: function (uint8Data) {
      if (!worker || !workerReady) {
        console.warn('[SoloBridge] Worker not ready to send packet');
        return;
      }
      worker.postMessage({
        action: 'SEND_PACKET',
        payload: { bytes: Array.from(uint8Data) }
      });
    },
    disconnect: function () {
      if (worker && workerReady) {
        worker.postMessage({
          action: 'DISCONNECT_PLAYER',
          payload: { index: 0 }
        });
      }
    },
    getRealm: function () {
      return currentRealm;
    },
    saveNow: function () {
      if (worker && workerReady) {
        if (window.muShowToast) window.muShowToast("Saving game progress...");
        worker.postMessage({
          action: 'SAVE_NOW',
          payload: { realm: currentRealm }
        });
      } else {
        var existing = loadSavedContainer(currentRealm);
        if (existing) {
          if (window.muShowToast) window.muShowToast("Vault saved in browser storage!");
        } else {
          if (window.muShowToast) window.muShowToast("Server not ready to save yet.");
        }
      }
    },
    exportSave: function () {
      if (worker && workerReady) {
        if (window.muShowToast) window.muShowToast("Preparing save export...");
        worker.postMessage({
          action: 'EXPORT_SAVES',
          payload: { realm: currentRealm, reason: 'download' }
        });
      } else {
        var raw = localStorage.getItem(getSaveKey(currentRealm));
        if (raw) {
          try {
            var parsed = JSON.parse(raw);
            var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(parsed, null, 2));
            var dlAnchor = document.createElement('a');
            dlAnchor.setAttribute("href", dataStr);
            dlAnchor.setAttribute("download", "mu_solo_realm_" + currentRealm + "_save.musav");
            document.body.appendChild(dlAnchor);
            dlAnchor.click();
            dlAnchor.remove();
            if (window.muShowToast) window.muShowToast("Save exported from storage!");
            return;
          } catch (e) {}
        }
        if (window.muShowToast) window.muShowToast("No save data found to export.");
      }
    },
    importSave: function (file) {
      if (!file) return;
      if (window.muShowToast) window.muShowToast("Reading save file...");
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var content = e.target.result;
          var parsed = JSON.parse(content);
          if (!parsed || typeof parsed !== 'object') {
            throw new Error("Invalid save file structure");
          }
          localStorage.setItem(getSaveKey(currentRealm), JSON.stringify(parsed));
          console.log('[SoloBridge] Save imported into localStorage for realm', currentRealm);
          if (window.muShowToast) window.muShowToast("Save imported! Reloading game engine...", 2000);
          setTimeout(function () {
            window.location.reload();
          }, 450);
        } catch (err) {
          console.error('[SoloBridge] Import save failed:', err);
          alert("Failed to import save file: " + err.message + "\nPlease verify the file format.");
        }
      };
      reader.onerror = function () {
        if (window.muShowToast) window.muShowToast("Error reading save file.");
      };
      reader.readAsText(file);
    }
  };

  window.soloSaveGameNow = function () {
    if (window.soloBridge && window.soloBridge.saveNow) window.soloBridge.saveNow();
  };

  window.soloExportSave = function () {
    if (window.soloBridge && window.soloBridge.exportSave) window.soloBridge.exportSave();
  };

  window.soloImportSave = function (file) {
    if (window.soloBridge && window.soloBridge.importSave) window.soloBridge.importSave(file);
  };

  window.soloExitGame = function () {
    console.log('[SoloBridge] Exiting game and reloading cleanly...');
    if (worker && workerReady) {
      worker.postMessage({
        action: 'DISCONNECT_PLAYER',
        payload: { index: 0 }
      });
    }
    setTimeout(function () {
      window.location.reload();
    }, 350);
  };

  // Pre-initialize server worker in background while assets load
  initServerWorker(0);
})();

// ── 4b. Top Bar Controls & System Utilities ────────────────────────────────

window.muShowToast = function (msg, duration) {
  var toast = document.getElementById('muToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  if (toast._timer) clearTimeout(toast._timer);
  toast._timer = setTimeout(function () {
    toast.classList.remove('show');
    toast._timer = null;
  }, duration || 2500);
};

window.muAutoAttackActive = false;
window.muAutoAttackInterval = null;

window.muToggleAutoAttack = function () {
  window.muAutoAttackActive = !window.muAutoAttackActive;
  var on = window.muAutoAttackActive;

  var btn = document.getElementById('muBtnAutoAttack');
  var playIcon = btn ? btn.querySelector('.mu-icon-play') : null;
  var stopIcon = btn ? btn.querySelector('.mu-icon-stop') : null;
  var textSpan = document.getElementById('muAutoAttackText');

  if (btn) btn.classList.toggle('active', on);
  if (playIcon) playIcon.style.display = on ? 'none' : 'block';
  if (stopIcon) stopIcon.style.display = on ? 'block' : 'none';
  if (textSpan) textSpan.textContent = on ? 'Stop' : 'Auto';
  if (btn) btn.title = on ? 'Stop Auto-Attack (Currently Active)' : 'Start Auto-Attack (Hold RMB at Center)';

  // 1. Call native C++ auto-attack export if available
  if (typeof Module !== 'undefined' && Module._mu_auto_attack) {
    Module._mu_auto_attack(on ? 1 : 0);
  }

  // 2. High-reliability JS loop fallback
  if (on) {
    if (typeof Module !== 'undefined') {
      if (Module._mu_cursor) Module._mu_cursor(320, 240);
      if (Module._mu_rbutton) Module._mu_rbutton(1);
    }
    if (window.muAutoAttackInterval) clearInterval(window.muAutoAttackInterval);
    window.muAutoAttackInterval = setInterval(function () {
      if (!window.muAutoAttackActive) return;
      if (typeof Module !== 'undefined') {
        if (Module._mu_cursor) Module._mu_cursor(320, 240);
        if (Module._mu_rbutton) Module._mu_rbutton(1);
      }
    }, 120);
    window.muShowToast("Auto-Attack: ACTIVE (Center Targeting)");
  } else {
    if (window.muAutoAttackInterval) {
      clearInterval(window.muAutoAttackInterval);
      window.muAutoAttackInterval = null;
    }
    if (typeof Module !== 'undefined' && Module._mu_rbutton) {
      Module._mu_rbutton(0);
    }
    window.muShowToast("Auto-Attack: STOPPED");
  }
};

window.muToggleFullscreen = function () {
  var doc = document.documentElement;
  var isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
  if (!isFs) {
    var req = doc.requestFullscreen || doc.webkitRequestFullscreen || doc.mozRequestFullScreen || doc.msRequestFullscreen;
    if (req) req.call(doc).catch(function () {});
  } else {
    var exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (exit) exit.call(document).catch(function () {});
  }
};

window.muUpdateFsIcons = function () {
  var isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
  var btn = document.getElementById('muBtnFullscreen');
  var enter = btn ? btn.querySelector('.mu-icon-fs-enter') : null;
  var exit = btn ? btn.querySelector('.mu-icon-fs-exit') : null;
  if (enter) enter.style.display = isFs ? 'none' : 'block';
  if (exit) exit.style.display = isFs ? 'block' : 'none';
  if (btn) btn.title = isFs ? 'Exit Fullscreen' : 'Toggle Fullscreen';
};

window.muUpdateRealmBadge = function (mode) {
  var lbl = document.getElementById('muRealmLabel');
  var badge = document.getElementById('muRealmBadge');
  if (!lbl || !badge) return;
  var modes = [
    { name: 'ARCADIA [EASY] (300x)', class: 'realm-easy', title: 'Server Realm: Arcadia [Easy] (300x EXP Rate, 150% Drops, Level 300 Reset)' },
    { name: 'VALHALLA [MED] (100x)', class: 'realm-medium', title: 'Server Realm: Valhalla [Medium] (100x EXP Rate, 100% Drops, Level 400 Reset)' },
    { name: 'ASGARD [HARD] (30x)', class: 'realm-hard', title: 'Server Realm: Asgard [Hard] (30x EXP Rate, 50% Drops, Level 400 Reset)' },
    { name: 'ELYSIUM [FUN] (300x)', class: 'realm-fun-easy', title: 'Server Realm: Elysium [Easy FUN] (300x EXP, Top Shop Gear, Wings & Kundun Boxes)' },
    { name: 'OLYMPUS [FUN] (100x)', class: 'realm-fun-medium', title: 'Server Realm: Olympus [Med FUN] (100x EXP, Top Shop Gear, Wings & Kundun Boxes)' },
    { name: 'ATLANTIS [FUN] (30x)', class: 'realm-fun-hard', title: 'Server Realm: Atlantis [Hard FUN] (30x EXP, Top Shop Gear, Wings & Kundun Boxes)' }
  ];
  var m = modes[mode] || modes[0];
  lbl.textContent = m.name;
  badge.className = 'mu-realm-badge ' + m.class;
  badge.title = m.title;
};

window.muOpenInfoModal = function () {
  var modal = document.getElementById('muInfoModal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
};

window.muCloseInfoModal = function () {
  var modal = document.getElementById('muInfoModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
};

window.muApplyTitleParam = function () {
  try {
    var params = new URLSearchParams(window.location.search);
    var generalTitle = (params.get('title') || '').trim();
    var htmlTitle = (params.get('html_title') || params.get('htmltitle') || params.get('html-title') || params.get('html title') || params.get('htmlTitle') || generalTitle).trim();
    var preloaderTitle = (params.get('preloader') || params.get('preloader_title') || params.get('preloadertitle') || params.get('preloader-title') || generalTitle).trim();
    var brandTitle = (params.get('brand') || params.get('brand_title') || params.get('brandTitle') || generalTitle).trim();

    if (htmlTitle) {
      document.title = htmlTitle;
    }
    if (preloaderTitle) {
      var pEls = document.querySelectorAll('.mu-preloader-title, #mu-preloader-title');
      for (var i = 0; i < pEls.length; i++) {
        pEls[i].textContent = preloaderTitle;
      }
    }
    if (brandTitle) {
      var bEls = document.querySelectorAll('.mu-brand-title, #mu-brand-title');
      for (var j = 0; j < bEls.length; j++) {
        bEls[j].textContent = brandTitle;
      }
    }
  } catch (e) {
    console.error('Failed to apply title params:', e);
  }
};

window.muInstallTopBar = function () {
  window.muApplyTitleParam();
  if (window._muTopBarInstalled) return;
  window._muTopBarInstalled = true;

  var btnSave = document.getElementById('muBtnSave');
  var btnImport = document.getElementById('muBtnImport');
  var fileInput = document.getElementById('muSaveFileInput');
  var btnExport = document.getElementById('muBtnExport');
  var btnAuto = document.getElementById('muBtnAutoAttack');
  var btnInfo = document.getElementById('muBtnInfo');
  var btnFs = document.getElementById('muBtnFullscreen');
  var modal = document.getElementById('muInfoModal');
  var closeBtn = document.getElementById('muModalCloseBtn');
  var closeFootBtn = document.getElementById('muModalCloseFooter');
  var backdrop = document.getElementById('muModalBackdrop');

  if (btnSave) {
    btnSave.addEventListener('click', function (e) {
      e.preventDefault();
      window.soloSaveGameNow();
    });
  }

  if (btnImport && fileInput) {
    btnImport.addEventListener('click', function (e) {
      e.preventDefault();
      fileInput.value = '';
      fileInput.click();
    });
    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) {
        window.soloImportSave(fileInput.files[0]);
      }
    });
  }

  if (btnExport) {
    btnExport.addEventListener('click', function (e) {
      e.preventDefault();
      window.soloExportSave();
    });
  }

  if (btnAuto) {
    btnAuto.addEventListener('click', function (e) {
      e.preventDefault();
      window.muToggleAutoAttack();
    });
  }

  if (btnInfo) {
    btnInfo.addEventListener('click', function (e) {
      e.preventDefault();
      window.muOpenInfoModal();
    });
  }

  if (closeBtn) closeBtn.addEventListener('click', window.muCloseInfoModal);
  if (closeFootBtn) closeFootBtn.addEventListener('click', window.muCloseInfoModal);
  if (backdrop) backdrop.addEventListener('click', window.muCloseInfoModal);

  // Tab switching inside modal
  if (modal) {
    var tabBtns = modal.querySelectorAll('.mu-tab-btn');
    tabBtns.forEach(function (tabBtn) {
      tabBtn.addEventListener('click', function () {
        var targetId = tabBtn.getAttribute('data-tab');
        if (!targetId) return;
        tabBtns.forEach(function (b) { b.classList.remove('active'); });
        tabBtn.classList.add('active');
        var panes = modal.querySelectorAll('.mu-tab-pane');
        panes.forEach(function (pane) {
          pane.classList.toggle('active', pane.id === targetId);
        });
      });
    });
  }

  // Close modal on Escape key
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.keyCode === 27) {
      if (modal && modal.classList.contains('open')) {
        e.preventDefault();
        e.stopPropagation();
        window.muCloseInfoModal();
      }
    }
  }, true);

  if (btnFs) {
    btnFs.addEventListener('click', function (e) {
      e.preventDefault();
      window.muToggleFullscreen();
    });
  }

  // Google Analytics outbound tracking for Play Online link
  var linkRealServer = document.getElementById('muLinkRealServer');
  if (linkRealServer) {
    linkRealServer.addEventListener('click', function () {
      if (typeof window.gtag === 'function') {
        var targetUrl = linkRealServer.href || 'https://muonline.digitalsplace.com/?utm_source=solo-classic&utm_medium=referral&utm_campaign=play-online&utm_content=topbar';
        window.gtag('event', 'play_online_click', {
          event_category: 'engagement',
          event_label: targetUrl,
          link_url: targetUrl,
          link_text: 'Play Online',
          transport_type: 'beacon'
        });
      }
    });
  }

  // Google Analytics outbound tracking for Support link
  var linkSupport = document.getElementById('muLinkSupport');
  if (linkSupport) {
    linkSupport.addEventListener('click', function () {
      if (typeof window.gtag === 'function') {
        var targetUrl = linkSupport.href || 'https://donatello.to/andvolodko';
        window.gtag('event', 'support_click', {
          event_category: 'engagement',
          event_label: targetUrl,
          link_url: targetUrl,
          link_text: 'Support',
          transport_type: 'beacon'
        });
      }
    });
  }

  document.addEventListener('fullscreenchange', window.muUpdateFsIcons);
  document.addEventListener('webkitfullscreenchange', window.muUpdateFsIcons);

  var r = (window.soloBridge && window.soloBridge.getRealm) ? window.soloBridge.getRealm() : 0;
  window.muUpdateRealmBadge(r);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    if (window.muInstallTopBar) window.muInstallTopBar();
  });
} else {
  if (window.muInstallTopBar) window.muInstallTopBar();
}

// ── 5. DOM & Runtime Logging ───────────────────────────────────────────────

var statusElement = document.getElementById('status');
var canvasElement = document.getElementById('canvas');
if (canvasElement) {
  canvasElement.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
}
var logElement = document.getElementById('log');

window.onerror = function (msg, src, line, col, err) {
  if (logElement) {
    logElement.textContent += 'ONERR ' + msg + '\n' + (err && err.stack ? err.stack : '') + '\n';
  }
  var mErr = document.getElementById('muStatusMsg');
  if (mErr) {
    mErr.style.color = '#ef4444';
    mErr.textContent = 'Loading error. Please refresh the page.';
  }
};

// ── 6. Emscripten Module Configuration ──────────────────────────────────────

var Module = {
  HEAPU8: null,
  print: function () {
    console.log(Array.prototype.slice.call(arguments).join(' '));
  },
  printErr: function () {
    var text = Array.prototype.slice.call(arguments).join(' ');
    console.error(text);
    if (logElement) {
      var lines = logElement.textContent ? logElement.textContent.split('\n') : [];
      lines.push(text);
      if (lines.length > 40) lines = lines.slice(lines.length - 40);
      logElement.textContent = lines.join('\n');
    }
  },
  canvas: canvasElement,
  onRuntimeInitialized: function () {
    if (window.finishPreloader) window.finishPreloader();
    if (window.soloBridge && window.soloBridge.flushQueue) window.soloBridge.flushQueue();
    if (window.muInstallTopBar) window.muInstallTopBar();
    if (window.muInstallKeys) window.muInstallKeys();
    if (window.muInstallTouch) window.muInstallTouch();
    if (window.muInstallPad) window.muInstallPad();
    if (window.muInstallAudio) window.muInstallAudio();
  },
  setStatus: function (text) {
    if (statusElement) statusElement.textContent = text;
    if (!text) {
      if (window.finishPreloader) window.finishPreloader();
      return;
    }
    var m = text.match(/([^(]+)\((\d+(\.\d+)?)\/(\d+)\)/);
    if (m) {
      var current = parseInt(m[2]);
      var total = parseInt(m[4]);
      if (total > 0 && current > total) {
        total = current;
      }
      var pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
      var curMb = (current / (1024 * 1024)).toFixed(1);
      var totMb = (total / (1024 * 1024)).toFixed(1);
      if (window.setPreloaderProgress) {
        window.setPreloaderProgress(pct, "Downloading game assets...", curMb + " / " + totMb + " MB (" + pct + "%)");
      }
    } else if (text.indexOf('Preparing') !== -1) {
      if (window.setPreloaderProgress) {
        window.setPreloaderProgress(92, "Compiling WebAssembly engine...", "92%");
      }
    } else if (text.indexOf('Running') !== -1) {
      if (window.finishPreloader) window.finishPreloader();
    } else {
      if (window.setPreloaderProgress) {
        window.setPreloaderProgress(50, text, "");
      }
    }
  },
  locateFile: function (path) { return path + `?t=${BUILD_VERSION}`; },
  preRun: [function () {
    var orig = FS.lookupPath;
    function child(node, name) {
      if (!node || !node.contents) return null;
      if (node.contents[name]) return { name: name, node: node.contents[name] };
      var want = name.toLowerCase();
      for (var k in node.contents) {
        if (k.toLowerCase() === want) return { name: k, node: node.contents[k] };
      }
      return null;
    }
    FS.lookupPath = function (path, opts) {
      if (typeof path === 'string') path = path.split('\\').join('/');
      var exact;
      try {
        exact = orig(path, opts);
      } catch (err) {
        if (!err || err.errno !== 44) throw err;
        exact = null;
      }
      if (exact && exact.node) return exact;
      var abs = PATH.isAbs(path) ? path : (FS.cwd() + '/' + path);
      var parts = abs.split('/').filter(function (p) { return p && p !== '.'; });
      var node = FS.root;
      var built = [];
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] === '..') {
          built.pop();
          node = (node && node.parent) || FS.root;
          continue;
        }
        var hit = child(node, parts[i]);
        if (!hit) {
          if (exact) return exact;
          throw new FS.ErrnoError(44);
        }
        built.push(hit.name);
        node = hit.node;
        if (node && node.mounted && node.mounted.root && i !== parts.length - 1)
          node = node.mounted.root;
      }
      return orig('/' + built.join('/'), opts);
    };
  }]
};
window.Module = Module;
