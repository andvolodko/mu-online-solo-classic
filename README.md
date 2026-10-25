# MU Online Solo Classic (0.97k) - WebAssembly Server & Engine

[![Play Online](https://img.shields.io/badge/Play%20Online-GitHub%20Pages-2ea44f?style=for-the-badge&logo=github&logoColor=white)](https://andvolodko.github.io/mu-online-solo-classic/)
[![Support on Donatello](https://img.shields.io/badge/%E2%99%A5%20Support-Donatello-f43f5e?style=for-the-badge)](https://donatello.to/andvolodko)

[![WebAssembly](https://img.shields.io/badge/WebAssembly-WASM-654FF0?logo=webassembly&logoColor=white)](https://webassembly.org/)
[![C++17](https://img.shields.io/badge/C%2B%2B-17-00599C?logo=c%2B%2B&logoColor=white)](https://isocpp.org/)
[![Emscripten](https://img.shields.io/badge/Emscripten-3.x-red)](https://emscripten.org/)
[![Status](https://img.shields.io/badge/Server-100%25%20Client--Side-brightgreen)](https://github.com/andvolodko/mu-online-solo-classic)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.md)

> 🎮 **Play Live in Browser:** **[https://andvolodko.github.io/mu-online-solo-classic/](https://andvolodko.github.io/mu-online-solo-classic/)**  
> 💖 **Support Project:** **[https://donatello.to/andvolodko](https://donatello.to/andvolodko)**
>
> A complete, standalone **MU Online Season 0.97k GameServer engine** compiled to **WebAssembly (WASM)** via **Emscripten** for pure client-side solo gameplay directly in modern web browsers.

---

## 🎯 Project Overview

Classic MU Online 0.97k was designed as a multi-daemon distributed architecture (`ConnectServer`, `JoinServer`, `DataServer`, and `GameServer`) that required continuous TCP network connections, complex IPC, and an external relational database (MySQL or MSSQL).

For a seamless single-player experience, this project collapses that entire stack into a **compact, zero-latency in-browser WebAssembly monolith**:

1. **No External Server or Database Required**: The entire game world, account management, character persistence, and game loops run directly in the browser.
2. **Eliminated ConnectServer & JoinServer**: Authentication and account handshakes are handled internally inside the virtual runtime.
3. **In-Memory Packet Channel (SoloTransport)**: Client and server communicate through fast memory-buffered binary packets (C1/C2 protocols) with **0 ms latency** via Web Workers.
4. **Local Virtual Storage (SoloDataServer)**: Characters, inventories, and warehouses are stored locally in the virtual filesystem (`/saves`), secured with **AES-256-GCM** encryption and **SHA-256** checksum integrity.
5. **Original 0.97k Game Content Packed in Virtual VFS (`/Data`)**:
   - **17 Maps & Collision Terrains** (`Terrain1.att` ... `Terrain17.att` — Lorencia, Devias, Noria, Lost Tower, Atlans, Tarkan, Blood Castle, Devil Square, etc.).
   - **3,245 Monsters & NPC Spawns** (`Monster.txt`, `MonsterSetBase.txt`).
   - Authentic combat mechanics, formulas, skill tree, quest progression, item drop rates, and Chaos Machine combinations.

---

## ⚔️ Three Difficulty Realms

The engine provides 3 dedicated game modes with completely **isolated save slots and warehouses** (no player trading):

| Feature / Rate | 🟢 Easy | 🟡 Medium | 🔴 Hard |
| :--- | :---: | :---: | :---: |
| ⭐ **Experience (EXP)** | **300x** | **100x** | **30x** |
| 🏰 **Event EXP (BC / DS)** | **300x** | **100x** | **30x** |
| 🎁 **Item Drop Rate** | **150%** | **100%** | **50%** |
| 💰 **Zen Drop Rate** | **100%** | **50%** | **25%** |
| 🔄 **Reset Requirement** | **Level 300** | **Level 400** | **Level 400** |
| 👑 **Grand Reset** | **50 Resets** | **100 Resets** | **150 Resets** |
| 👹 **Monster HP & Damage** | **0.7x** | **1.0x** | **1.5x** |
| 💀 **Death Penalty (EXP loss)** | **None (0%)** | **Normal (3%)** | **Double (6%)** |
| ✨ **Excellent & Ancient Drop** | **1.5x** | **1.0x** | **0.5x** |
| 🤝 **Player Trade** | ❌ *Disabled* | ❌ *Disabled* | ❌ *Disabled* |
| 📦 **Vault / Warehouse** | 🔒 *Isolated* | 🔒 *Isolated* | 🔒 *Isolated* |

---

## 📁 Repository Structure

```
mu-online-solo-classic/
├── docs/                           # Documentation & manuals
│   ├── README.md                   # Documentation index
│   └── COMMANDS.md                 # Complete Server & GM Commands Guide
├── src/
│   ├── server/                     # Solo WebAssembly GameServer engine
│   │   ├── Common/
│   │   │   └── Platform.h          # Win32 API emulation types for POSIX & Emscripten
│   │   ├── GameServer/             # Original 0.97k GameServer logic (combat, monsters, items, maps)
│   │   ├── Solo/                   # Solo WebAssembly engine adaptations
│   │   │   ├── SoloServer.h        # C API exported functions for WASM / JS
│   │   │   ├── SoloServerMain.cpp  # Lifecycle, initialization, main 20 TPS tick loop
│   │   │   ├── SoloDifficulty.h    # Realm rates & difficulty multipliers interface
│   │   │   ├── SoloDifficulty.cpp  # Multiplier implementations (EXP, HP, DMG, drops)
│   │   │   ├── SoloTransport.h     # Zero-copy packet delivery interface
│   │   │   ├── SoloSocketManager.cpp # In-memory socket & connection manager
│   │   │   ├── SoloSocketManagerUdp.cpp # UDP socket dummy implementation
│   │   │   ├── SoloConnection.cpp  # Virtual JoinServer / DataServer links
│   │   │   └── SoloDataServer.cpp  # Local filesystem character & vault storage
│   │   ├── Data/                   # Original 0.97k game tables, configs, and .att terrain maps
│   │   ├── CMakeLists.txt          # Emscripten CMake build configuration
│   │   └── test_node.cjs           # Node.js automated test runner for the WASM build
│   └── client/                     # WebGL2 WebAssembly Client & C++ engine
│       ├── src/                    # Full 0.97k client C++ sources (24 subsystems: Render, UI, Model, Combat, etc.)
│       ├── lib/                    # Client libraries (miniaudio, libjpeg-6b)
│       ├── browser/                # WebGL2 immediate-mode pipeline, virtual stick, keyboard & shell
│       ├── docs/                   # Milestone porting specifications (M0-M7)
│       └── link-login.bat          # Client build and link automation
├── web/
│   ├── index.html                  # Playable full-screen 3D WebGL2 Game Client & in-browser runtime
│   ├── server_worker.js            # Dedicated Web Worker hosting the WASM GameServer
│   ├── serve.cjs                   # Lightweight local streaming HTTP server with CORS headers
│   ├── muserver.wasm               # Compiled GameServer WebAssembly binary (~698 KB)
│   ├── muserver.js                 # Emscripten JavaScript runtime glue & module loader
│   ├── muserver.data               # Preloaded virtual file system containing /Data (~1.47 MB)
│   ├── shell_login.js              # Client Emscripten runtime glue
│   ├── shell_login.wasm            # Client WebAssembly engine binary (~1.7 MB)
│   └── shell_login.data            # Client preloaded game assets (~219 MB)
└── reference/                      # Reference C++ sources (Server & Client)
```

> 📖 **In-Game Commands Guide**: For a full list of player commands (`/str`, `/agi`, `/reset`, `/ware`, `/pkclear`, etc.) and Game Master commands (`/make`, `/makeset`, `/evo`, `/makemob`, etc.), see [**`docs/COMMANDS.md`**](docs/COMMANDS.md).

---

## 🛠️ Building the WebAssembly Server

### Prerequisites

| Tool | Minimum Version | Linux Package (Debian/Ubuntu) | macOS (Homebrew) | Windows (Winget / Choco) |
| :--- | :--- | :--- | :--- | :--- |
| **CMake** | 3.16+ | `sudo apt install cmake` | `brew install cmake` | `winget install Kitware.CMake` |
| **Ninja** | 1.10+ | `sudo apt install ninja-build` | `brew install ninja` | `winget install Ninja-build.Ninja` |
| **Python** | 3.8+ | `sudo apt install python3` | `brew install python` | `winget install Python.Python.3.11` |
| **Node.js** | 18+ | `sudo apt install nodejs` | `brew install node` | `winget install OpenJS.NodeJS.LTS` |
| **Git** | Any | `sudo apt install git` | `brew install git` | `winget install Git.Git` |

---

### Step 1: Install & Setup Emscripten SDK (`emsdk`)

#### On Linux / macOS:
```bash
# Clone the Emscripten SDK repository
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk

# Download and install the latest SDK tools
./emsdk install latest

# Set up the active SDK
./emsdk activate latest

# Source the environment variables in your current shell
source ./emsdk_env.sh
```

> **Tip (Linux/macOS):** Add `source ~/emsdk/emsdk_env.sh` to your `~/.bashrc` or `~/.zshrc` for persistent access.

#### On Windows:
```cmd
:: Clone the Emscripten SDK repository
git clone https://github.com/emscripten-core/emsdk.git C:\emsdk
cd /d C:\emsdk

:: Download, install, and activate the latest SDK
emsdk install latest
emsdk activate latest

:: Set up environment variables in current command prompt
call emsdk_env.bat
```

---

### Step 2: Compile the GameServer to WebAssembly

#### On Linux / macOS:
```bash
# Navigate to the repository root
cd /path/to/mu-online-solo-classic

# Configure the project with Emscripten CMake
emcmake cmake -S src/server -B src/server/build -G Ninja -DCMAKE_BUILD_TYPE=Release

# Build the WebAssembly binary and preloaded virtual filesystem
ninja -C src/server/build

# Copy generated artifacts (muserver.js, muserver.wasm, muserver.data) to web/
cp src/server/build/muserver.* web/
```

#### On Windows (PowerShell or Command Prompt):
```cmd
:: Navigate to repository root
cd path\to\mu-online-solo-classic

:: Configure the project with Emscripten CMake
emcmake cmake -S src/server -B src/server/build -G Ninja -DCMAKE_BUILD_TYPE=Release

:: Build with Ninja
ninja -C src/server/build

:: Copy artifacts to web/ directory
copy src\server\build\muserver.* web\
```

---

### Step 3: Run the Automated Verification Suite

Verify the generated WebAssembly binary directly in Node.js before launching the browser:

```bash
node src/server/test_node.cjs
```

**Expected output:**
```
[NodeTest] Loading WebAssembly module from: .../web/muserver.js
[NodeTest] WebAssembly module successfully instantiated!
[NodeTest] Initializing SoloServer (Data: /Data, Saves: /saves)...
[NodeTest] Server initialization succeeded! (Return Code: 1)
[NodeTest] Spawned Monsters : 3,245
[NodeTest] Connected Players: 0
[NodeTest] Realm Difficulty : 1 (Medium 100x)
[NodeTest] Testing 20 TPS server ticks...
[NodeTest] Tick loop OK!
[NodeTest] ALL TESTS PASSED! GameServer is ready for web deployment.
```

---

## 🚀 Running the Web Game & Dashboard

### 🌐 Play Online (No Installation Required)
Directly in modern browsers: **[https://andvolodko.github.io/mu-online-solo-classic/](https://andvolodko.github.io/mu-online-solo-classic/)**

### 💖 Support the Project
Support development on Donatello: **[https://donatello.to/andvolodko](https://donatello.to/andvolodko)**

### 💻 Local Development Server
To run locally on your machine:

```bash
# Start the local development server (port 8088)
node web/serve.cjs
```
*(Alternatively, you can use Python: `python3 -m http.server 8088 -d web`)*

Open your browser at: **[http://127.0.0.1:8088](http://127.0.0.1:8088)**

### Dashboard Features:
- **Difficulty Realm Selector**: Instant switching between 🟢 **Easy (300x)**, 🟡 **Medium (100x)**, and 🔴 **Hard (30x)** with isolated vault slots and tailored drop/combat rates.
- **Server Health & Performance Metrics**: Real-time tick monitor (20 TPS / 50ms interval), active player count, and alive monster counter (3,245 entities).
- **Interactive Handshake Simulator**:
  1. `Connect Player`: Spawns an in-memory client connection with zero network overhead.
  2. `Login`: Authenticates virtual account (`solo` / `solo`).
  3. `Char List`: Retrieves available character slots.
  4. `Create Dark Knight`: Creates character `HeroDK` and persists it directly into encrypted storage.
  5. `Select HeroDK`: Enters the game world in Lorencia (X: 125, Y: 125).
  6. `Walk & Attack`: Sends authentic MU movement and attack packets to engage nearby monsters.
- **Live Packet Inspector**: Inspects bidirectional binary packets (`0xC1` / `0xC2`) with decoded protocol descriptions and hex visualizer in real time.
- **Cryptographic Save Management**:
  - Automatically persists encrypted progress to browser `LocalStorage` every 30 seconds and on window unload.
  - **Manual Save / Load**: Encrypts virtual `/saves` directory using **AES-256-GCM** with a **SHA-256** integrity check.
  - **Export / Import (.musav.json)**: Download and upload encrypted standalone backup files across browsers.

---

## ⚙️ WebAssembly C API Reference

The compiled module exports the following C interface to JavaScript:

```c
// Initializes the virtual game world and filesystem paths
int SoloServer_Init(const char* dataPath, const char* savePath);

// Advances the game simulation loop by elapsed milliseconds (recommended: 50ms / 20 TPS)
void SoloServer_Tick(int elapsedMs);

// Connects a virtual client session and returns player index (slot ID)
int SoloServer_ConnectPlayer(const char* ip);

// Disconnects an active player session
void SoloServer_DisconnectPlayer(int playerIndex);

// Injects an incoming client packet (C1/C2 binary stream) into GameServer logic
void SoloServer_ReceiveClientPacket(const uint8_t* packetBytes, int length);

// Registers the JavaScript callback for outgoing server packets (Server -> Client)
void SoloServer_SetSendCallback(void (*callback)(int playerIndex, const uint8_t* data, int size));

// Registers the JavaScript callback for auto-save notifications
void SoloServer_SetSaveCallback(void (*callback)());

// Sets the active realm difficulty mode: 0 = Easy, 1 = Medium, 2 = Hard
void SoloServer_SetDifficulty(int mode);

// Gets the current realm difficulty mode
int SoloServer_GetDifficulty();

// Returns total live spawned monsters across all 17 maps
int SoloServer_GetMonsterCount();

// Returns current connected player count
int SoloServer_GetPlayerCount();
```

---

## 🗺️ Roadmap

- [x] **Stage 1**: Port 0.97k GameServer core to C++17 POSIX & Emscripten.
- [x] **Stage 2**: Implement In-Memory transport & socket manager (`SoloSocketManager`).
- [x] **Stage 3**: Replace database with local VFS filesystem storage (`SoloDataServer`).
- [x] **Stage 4**: Build Web Worker server harness & interactive packet inspection testbed.
- [x] **Stage 5**: AES-256-GCM + SHA-256 encrypted browser persistence with standalone file export/import.
- [x] **Stage 6**: Multi-difficulty realm system (Easy, Medium, Hard) with isolated storage and anti-trade enforcement.
- [x] **Stage 7**: Integrate 3D WebGL2 / WebAssembly client renderer with touch controls, virtual joystick, gamepad, and audio.
- [x] **Stage 8**: Direct In-Memory bridge connecting WebGL2 Client and in-browser GameServer worker with 3 difficulty realms and passwordless login.

---

## 📜 Acknowledgements & Credits

Special thanks and sincere gratitude to the open-source projects and authors whose work made this standalone single-player recreation possible:

- **[EmanuelCatania / Mu-Linux-0.97k](https://github.com/EmanuelCatania/Mu-Linux-0.97k)**:
  Authoritative Linux C++ port of the classic MU Online 0.97k GameServer, DataServer, and protocol architecture by **Emanuel Catania**. It served as the direct reference foundation for our WebAssembly server engine and virtual VFS subsystem.
  
- **[EmanuelCatania / Mu-97k-Client-Source](https://github.com/EmanuelCatania/Mu-97k-Client-Source)**:
  Meticulous C++ reverse-engineering and source reconstruction of the original Win32 MU Online 0.97k client (`main.exe`) by **Emanuel Catania**. Provided the 24 client subsystems, 3D BMD models, terrain formats, item databases, and animation pipelines ported into WebGL 2.

- **[nicomuratona / MuEmu-0.97k-kayito](https://github.com/nicomuratona/MuEmu-0.97k-kayito)**:
  Pioneering server emulation and protocol reverse engineering by **Kayito (Nico Muratona)** and the MuEmu development community.

- **AI Development & Pair Programming**:
  Engine porting, WebAssembly compilation, WebGL2 pipeline adaptations, and browser integrations were pair-programmed with assistance from **Cursor (Grok 4.7 High)** and **Google Antigravity (Gemini 3.8 Flash High)**.

- **Webzen**:
  Original creators of **MU Online** (2001–2003). All game lore, audio, 3D assets, and visual designs remain the intellectual property of Webzen.

Ported, refactored, and architected for WebAssembly, WebGL2, and zero-network single-player browser gameplay by **Andriy Volodko**. Released strictly for educational, archival, and non-commercial research purposes under the [MIT License](LICENSE.md).
