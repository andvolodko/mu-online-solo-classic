// Web Worker hosting the compiled MU Online Solo GameServer WebAssembly module
const workerParams = (typeof self !== 'undefined' && self.location && self.location.search) 
    ? new URLSearchParams(self.location.search) 
    : new URLSearchParams('');
const WORKER_VERSION = workerParams.get('v') || 'login103';

importScripts(`muserver.js?v=${WORKER_VERSION}`);

let Module = null;
let tickTimer = null;
let lastTickTime = performance.now();

function log(msg, color = '#60a5fa') {
    self.postMessage({ type: 'LOG', message: msg, color: color });
}

// ============================================================================
// Cryptographic Vault for Save Games
// Standard Web Crypto API: AES-256-GCM + SHA-256 Tamper Detection Checksum
// ============================================================================
const VAULT_MAGIC = "MUSAV1";
const VAULT_SECRET = "MU_ONLINE_SOLO_CLASSIC_097K_WASM_VAULT_KEY";
const VAULT_SALT = new Uint8Array([
    0x4D, 0x55, 0x5F, 0x53, 0x4F, 0x4C, 0x4F, 0x5F,
    0x53, 0x41, 0x4C, 0x54, 0x30, 0x39, 0x37, 0x4B
]); // "MU_SOLO_SALT097K"

let cachedCryptoKey = null;

async function getVaultKey() {
    if (cachedCryptoKey) return cachedCryptoKey;
    const enc = new TextEncoder();
    const keyMaterial = await self.crypto.subtle.importKey(
        "raw",
        enc.encode(VAULT_SECRET),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );
    cachedCryptoKey = await self.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: VAULT_SALT,
            iterations: 10000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
    return cachedCryptoKey;
}

function readVirtualSaveFiles() {
    const saves = {};
    if (!Module || !Module.FS) return saves;

    try {
        if (Module.FS.analyzePath('/saves').exists) {
            const files = Module.FS.readdir('/saves').filter(f => f !== '.' && f !== '..');
            for (const file of files) {
                const data = Module.FS.readFile('/saves/' + file);
                let binary = '';
                const len = data.byteLength;
                for (let i = 0; i < len; i++) {
                    binary += String.fromCharCode(data[i]);
                }
                saves[file] = btoa(binary);
            }
        }
    } catch (err) {
        log(`[Worker] Error reading /saves: ${err.message}`, '#f87171');
    }
    return saves;
}

function writeVirtualSaveFiles(savesMap) {
    if (!Module || !Module.FS || !savesMap) return 0;

    let count = 0;
    try {
        try {
            if (!Module.FS.analyzePath('/saves').exists) {
                Module.FS.mkdir('/saves');
            }
        } catch (e) {
            // Directory might already exist
        }

        for (const [file, b64] of Object.entries(savesMap)) {
            try {
                const safeName = file.replace(/[^a-zA-Z0-9_.-]/g, '');
                if (!safeName || !b64) continue;

                const binary = atob(b64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                Module.FS.writeFile('/saves/' + safeName, bytes);
                count++;
            } catch (fileErr) {
                log(`[Worker] Warning: Failed to write /saves/${file}: ${fileErr.message}`, '#fbbf24');
            }
        }
        log(`[Worker] Restored ${count} save file(s) in /saves`, '#34d399');
    } catch (err) {
        log(`[Worker] Error writing /saves: ${err.message}`, '#f87171');
    }
    return count;
}

async function exportEncryptedSaves() {
    const rawFiles = readVirtualSaveFiles();
    const fileCount = Object.keys(rawFiles).length;

    // SubtleCrypto requires a Secure Context (HTTPS or localhost/127.0.0.1).
    // On LAN IPs (e.g. http://192.168.x.x), self.crypto.subtle is undefined by browser policy.
    const hasSubtle = typeof self !== 'undefined' && self.crypto && self.crypto.subtle;

    if (!hasSubtle) {
        log('[Vault] Web Crypto API (SubtleCrypto) unavailable in non-secure context (LAN/HTTP IP). Saving in unencrypted vault format.', '#fbbf24');
        const jsonStr = JSON.stringify(rawFiles);
        const encoded = new TextEncoder().encode(jsonStr);
        let binary = '';
        for (let i = 0; i < encoded.length; i++) binary += String.fromCharCode(encoded[i]);
        return {
            magic: VAULT_MAGIC,
            version: 1,
            encrypted: false,
            algorithm: "plain-base64",
            timestamp: Date.now(),
            filesCount: fileCount,
            payload: btoa(binary)
        };
    }

    try {
        const key = await getVaultKey();
        const jsonStr = JSON.stringify(rawFiles);
        const iv = self.crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(jsonStr);

        const ciphertextBuffer = await self.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            key,
            encoded
        );

        const cipherBytes = new Uint8Array(ciphertextBuffer);

        // Calculate SHA-256 integrity checksum over ciphertext
        const hashBuffer = await self.crypto.subtle.digest("SHA-256", cipherBytes);
        const hashHex = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        let cipherBinary = '';
        for (let i = 0; i < cipherBytes.length; i++) cipherBinary += String.fromCharCode(cipherBytes[i]);

        let ivBinary = '';
        for (let i = 0; i < iv.length; i++) ivBinary += String.fromCharCode(iv[i]);

        return {
            magic: VAULT_MAGIC,
            version: 1,
            encrypted: true,
            algorithm: "AES-GCM-256",
            timestamp: Date.now(),
            filesCount: fileCount,
            iv: btoa(ivBinary),
            checksum: hashHex,
            payload: btoa(cipherBinary)
        };
    } catch (err) {
        log(`[Vault] Save encryption error: ${err.message}`, '#ef4444');
        return null;
    }
}

async function importEncryptedSaves(container) {
    if (!container) return 0;

    try {
        // 1. Backward compatibility: handle legacy unencrypted save
        if (!container.magic && typeof container === 'object') {
            log('[Vault] Found unencrypted save (legacy). Restoring...', '#fbbf24');
            return writeVirtualSaveFiles(container);
        }

        if (container.magic !== VAULT_MAGIC) {
            throw new Error(`Unknown file format (expected header ${VAULT_MAGIC})`);
        }

        // 2. Unencrypted vault container (saved from LAN / non-secure context)
        if (container.encrypted === false) {
            log('[Vault] Restoring unencrypted vault payload...', '#34d399');
            const binary = atob(container.payload);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const jsonStr = new TextDecoder().decode(bytes);
            const rawFiles = JSON.parse(jsonStr);
            return writeVirtualSaveFiles(rawFiles);
        }

        // 3. Encrypted vault container - check if crypto.subtle is available
        const hasSubtle = typeof self !== 'undefined' && self.crypto && self.crypto.subtle;
        if (!hasSubtle) {
            throw new Error("This save is AES-256 encrypted, but Web Cryptography API is unavailable over non-secure HTTP. Please use http://127.0.0.1:8088/ or HTTPS.");
        }

        // 4. Decode ciphertext bytes
        const cipherBinary = atob(container.payload);
        const cipherBytes = new Uint8Array(cipherBinary.length);
        for (let i = 0; i < cipherBinary.length; i++) {
            cipherBytes[i] = cipherBinary.charCodeAt(i);
        }

        // 3. Verify SHA-256 integrity checksum
        const hashBuffer = await self.crypto.subtle.digest("SHA-256", cipherBytes);
        const hashHex = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        if (hashHex !== container.checksum) {
            throw new Error("Save corrupted or modified in text editor (SHA-256 checksum mismatch)!");
        }

        // 4. Decode IV
        const ivBinary = atob(container.iv);
        const iv = new Uint8Array(ivBinary.length);
        for (let i = 0; i < ivBinary.length; i++) {
            iv[i] = ivBinary.charCodeAt(i);
        }

        // 5. Decrypt using AES-GCM
        const key = await getVaultKey();
        let decryptedBuffer;
        try {
            decryptedBuffer = await self.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                key,
                cipherBytes
            );
        } catch (decryptErr) {
            throw new Error("AES-GCM authentication failed: save content was modified or tampered with!");
        }

        const jsonStr = new TextDecoder().decode(decryptedBuffer);
        const rawFiles = JSON.parse(jsonStr);

        return writeVirtualSaveFiles(rawFiles);
    } catch (err) {
        log(`[Vault] ❌ Decryption error: ${err.message}`, '#ef4444');
        self.postMessage({ type: 'SAVE_INTEGRITY_ERROR', message: err.message });
        return 0;
    }
}

function clearVirtualSaves() {
    if (!Module || !Module.FS) return;
    try {
        if (Module.FS.analyzePath('/saves').exists) {
            const files = Module.FS.readdir('/saves').filter(f => f !== '.' && f !== '..');
            for (const file of files) {
                Module.FS.unlink('/saves/' + file);
            }
        }
    } catch (err) {
        log(`[Worker] Error clearing /saves: ${err.message}`, '#f87171');
    }
}

async function initServer(initialSaves = null, difficulty = 0) {
    try {
        log('[Worker] Instantiating MU WebAssembly GameServer...', '#93c5fd');

        Module = await createMuServer({
            locateFile: (filename) => {
                if (typeof process !== 'undefined' && process.versions && process.versions.node) {
                    return filename;
                }
                return `${filename}?v=${WORKER_VERSION}`;
            },
            print: (text) => log(`[STDOUT] ${text}`, '#94a3b8'),
            printErr: (text) => log(`[STDERR] ${text}`, '#f87171')
        });

        // Set initial difficulty mode (0: Easy, 1: Medium, 2: Hard)
        if (Module._SoloServer_SetDifficulty) {
            Module._SoloServer_SetDifficulty(difficulty);
        }

        // Restore initial saves into virtual FS before server boot if provided
        if (initialSaves) {
            await importEncryptedSaves(initialSaves);
        }

        // Register outgoing packet callback (Server -> Client)
        const sendCallback = Module.addFunction((ptr, size) => {
            const bytes = new Uint8Array(Module.HEAPU8.subarray(ptr, ptr + size));
            const hex = Array.from(bytes.slice(0, Math.min(8, size))).map(b => b.toString(16).padStart(2, '0')).join(' ');
            log(`[Worker] Server sent ${size} bytes to client (${hex})`, '#34d399');
            self.postMessage({
                type: 'PACKET_FROM_SERVER',
                data: Array.from(bytes),
                size: size
            });
        }, 'vii');

        Module._SoloServer_SetSendCallback(sendCallback);

        // Register save event callback (Server -> Local Storage auto-save)
        let autoSaveTimer = null;
        const saveCallback = Module.addFunction(() => {
            if (autoSaveTimer) clearTimeout(autoSaveTimer);
            autoSaveTimer = setTimeout(() => {
                exportEncryptedSaves().then(currentSaves => {
                    if (currentSaves) {
                        self.postMessage({
                            type: 'AUTO_SAVE_DATA',
                            saves: currentSaves,
                            timestamp: Date.now()
                        });
                    }
                });
            }, 250);
        }, 'v');

        Module._SoloServer_SetSaveCallback(saveCallback);

        log('[Worker] Initializing Game World and Data Files (/Data)...', '#a78bfa');
        let initResult = 0;
        try {
            initResult = Module.ccall('SoloServer_Init', 'number', ['string', 'string'], ['/Data', '/saves']);
        } catch (initErr) {
            log(`[Worker] Fatal exception in SoloServer_Init: ${initErr.message}`, '#ef4444');
            if (initErr.stack) log(`[Worker] Stack: ${initErr.stack}`, '#ef4444');
            self.postMessage({ type: 'ERROR', message: initErr.message, stack: initErr.stack });
            return;
        }

        if (initResult !== 1) {
            log('[Worker] ERROR: SoloServer_Init failed!', '#ef4444');
            self.postMessage({ type: 'ERROR', message: 'Server initialization failed' });
            return;
        }

        const monsters = Module._SoloServer_GetMonsterCount();
        const players = Module._SoloServer_GetPlayerCount();

        log(`[Worker] Server running! Total Monsters: ${monsters}, Players: ${players}`, '#34d399');

        // Start server simulation tick loop (20 TPS / 50ms)
        lastTickTime = performance.now();
        tickTimer = setInterval(() => {
            const now = performance.now();
            const elapsedMs = Math.min(200, Math.round(now - lastTickTime));
            lastTickTime = now;
            if (Module) {
                Module._SoloServer_Tick(elapsedMs);
            }
        }, 50);

        self.postMessage({
            type: 'SERVER_READY',
            monsters: monsters,
            players: players,
            difficulty: difficulty
        });
    } catch (err) {
        log(`[Worker] Critical Exception: ${err.message}`, '#ef4444');
        if (err.stack) {
            log(`[Worker] Stack: ${err.stack}`, '#ef4444');
        }
        self.postMessage({ type: 'ERROR', message: err.message, stack: err.stack });
    }
}

self.onmessage = async function (e) {
    const { action, payload } = e.data;

    if (!Module && action !== 'INIT') {
        return;
    }

    switch (action) {
        case 'INIT': {
            await initServer(payload?.saves, payload?.difficulty ?? 0);
            break;
        }

        case 'SET_DIFFICULTY': {
            const mode = payload?.mode ?? 0;
            if (Module && Module._SoloServer_SetDifficulty) {
                Module._SoloServer_SetDifficulty(mode);
                const modeNames = [
                    'Easy (Arcadia)',
                    'Medium (Valhalla)',
                    'Hard (Asgard)',
                    'Easy FUN (Elysium)',
                    'Medium FUN (Olympus)',
                    'Hard FUN (Atlantis)'
                ];
                log(`[Worker] Difficulty set to: ${modeNames[mode] || mode}`, '#34d399');
                self.postMessage({
                    type: 'DIFFICULTY_SET',
                    mode: mode
                });
            }
            break;
        }

        case 'SWITCH_REALM': {
            clearVirtualSaves();
            const count = await importEncryptedSaves(payload?.saves);
            const mode = payload?.mode ?? 0;
            if (Module && Module._SoloServer_SetDifficulty) {
                Module._SoloServer_SetDifficulty(mode);
            }
            const modeNames = [
                'Easy (Arcadia)',
                'Medium (Valhalla)',
                'Hard (Asgard)',
                'Easy FUN (Elysium)',
                'Medium FUN (Olympus)',
                'Hard FUN (Atlantis)'
            ];
            log(`[Worker] Realm switched to: ${modeNames[mode]}. Loaded ${count} save file(s).`, '#34d399');
            self.postMessage({
                type: 'REALM_SWITCHED',
                mode: mode,
                count: count
            });
            break;
        }

        case 'CONNECT_PLAYER': {
            const ip = payload?.ip || '127.0.0.1';
            const playerIndex = Module.ccall('SoloServer_ConnectPlayer', 'number', ['string'], [ip]);
            self.postMessage({
                type: 'PLAYER_CONNECTED',
                playerIndex: playerIndex,
                monsters: Module._SoloServer_GetMonsterCount(),
                players: Module._SoloServer_GetPlayerCount()
            });
            break;
        }

        case 'DISCONNECT_PLAYER': {
            const index = payload?.index || 0;
            Module._SoloServer_DisconnectPlayer(index);
            self.postMessage({
                type: 'PLAYER_DISCONNECTED',
                index: index
            });
            break;
        }

        case 'SEND_PACKET': {
            const rawBytes = new Uint8Array(payload.bytes);
            log(`[Worker] SEND_PACKET from client: ${rawBytes.length} bytes, hdr=0x${rawBytes[0].toString(16)}`, '#38bdf8');
            const ptr = Module._malloc(rawBytes.length);
            Module.HEAPU8.set(rawBytes, ptr);
            Module._SoloServer_ReceiveClientPacket(ptr, rawBytes.length);
            Module._free(ptr);
            break;
        }

        case 'EXPORT_SAVES': {
            if (Module && typeof Module._SoloServer_SaveAll === 'function') {
                const flushed = Module._SoloServer_SaveAll();
                log(`[Worker] Flushed in-game state for ${flushed} active player(s) before export`, '#34d399');
            }
            const saves = await exportEncryptedSaves();
            self.postMessage({
                type: 'SAVES_EXPORTED',
                saves: saves,
                realm: payload?.realm,
                reason: payload?.reason,
                timestamp: Date.now()
            });
            break;
        }

        case 'SAVE_NOW': {
            if (Module && typeof Module._SoloServer_SaveAll === 'function') {
                const flushed = Module._SoloServer_SaveAll();
                log(`[Worker] Flushed in-game state for ${flushed} active player(s) before save`, '#34d399');
            }
            const saves = await exportEncryptedSaves();
            if (saves) {
                self.postMessage({
                    type: 'AUTO_SAVE_DATA',
                    saves: saves,
                    timestamp: Date.now(),
                    manual: true
                });
            }
            self.postMessage({
                type: 'SAVE_NOW_COMPLETE',
                success: !!saves,
                saves: saves,
                realm: payload?.realm,
                timestamp: Date.now()
            });
            break;
        }

        case 'IMPORT_SAVES': {
            const count = await importEncryptedSaves(payload?.saves);
            self.postMessage({
                type: 'SAVES_IMPORTED',
                count: count
            });
            break;
        }

        case 'GET_STATS': {
            self.postMessage({
                type: 'STATS_UPDATE',
                monsters: Module._SoloServer_GetMonsterCount(),
                players: Module._SoloServer_GetPlayerCount()
            });
            break;
        }
    }
};
