![Banner](https://i.imgur.com/Txnw4YJ.png)

A desktop app for managing Minecraft Java Edition servers, built with Tauri 2, React 19, and Rust.

Create, start, stop, and monitor multiple servers from a single panel. Each server type is downloaded automatically from its official source. No manual jar hunting required.

---

## Features

- **Multi-server dashboard** with a card grid showing live status and player counts
- **Four server types** supported out of the box: Vanilla, Paper, Fabric, and Forge
- **Guided creation wizard** in four steps: name, type, version, port and RAM
- **Live console** with color-coded log output (INFO, WARN, ERROR) and a command input
- **Player list** refreshed every 10 seconds via the Minecraft Server List Ping protocol
- **File manager** with breadcrumb navigation, built-in text editor, and system file opener
- **Download progress** reported in real time during server installation
- **Graceful start and stop** via stdin (`stop` command) with automatic process reaping

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Java 17+ | Must be on `PATH` or `JAVA_HOME` set. Required to run servers. |
| Node.js 18+ | For the frontend build toolchain. |
| Rust (stable) | Install via [rustup](https://rustup.rs). |
| MSYS2 (Windows) | Provides the GNU toolchain. Install from [msys2.org](https://www.msys2.org). |

### Windows-specific toolchain setup

This project uses the GNU Rust toolchain (`stable-x86_64-pc-windows-gnu`). MSVC is **not** supported because it requires Visual Studio Build Tools which are not assumed to be present.

Install the required MSYS2 packages if you have not already:

```powershell
# In an MSYS2 ucrt64 terminal
pacman -S mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-binutils
```

Before running any `cargo` or `tauri` command in a regular PowerShell terminal, prepend the MSYS2 ucrt64 `bin` directory to `PATH`:

```powershell
$env:PATH = "C:\msys64\ucrt64\bin;" + $env:PATH
```

Alternatively, run all commands from within an MSYS2 ucrt64 terminal where that directory is already on `PATH`.

---

## Getting started

### 1. Install Node dependencies

```powershell
npm install
```

### 2. Run in development mode

Using the convenience script (sets `PATH` and launches `tauri dev`):

```powershell
npm start
```

Or manually:

```powershell
$env:PATH = "C:\msys64\ucrt64\bin;" + $env:PATH
npm run tauri dev
```

### 3. Build a release binary

```powershell
$env:PATH = "C:\msys64\ucrt64\bin;" + $env:PATH
npm run tauri build
```

The installer and standalone executable are placed in `src-tauri/target/release/bundle/`.

---

## Project structure

```
launchstone/
├── src/                          # React frontend (Vite + TypeScript)
│   ├── components/
│   │   ├── CreateServerModal.tsx # Four-step creation wizard
│   │   ├── FileManager.tsx       # File browser and text editor
│   │   ├── ServerCard.tsx        # Dashboard card with start/stop/delete
│   │   ├── ServerTypeIcon.tsx    # Official server type logos
│   │   ├── Sidebar.tsx           # Left navigation panel
│   │   └── StatusBadge.tsx       # Running/Stopped/Starting/Stopping pill
│   ├── lib/
│   │   └── tauri.ts              # Typed wrappers around invoke()
│   ├── pages/
│   │   ├── Home.tsx              # Dashboard grid, auto-refreshes every 5 s
│   │   └── ServerView.tsx        # Console, Players, and Files tabs
│   ├── types.ts                  # Shared TypeScript type definitions
│   └── App.css                   # CSS custom properties (colors, surfaces)
│
└── src-tauri/src/                # Rust backend
    ├── commands.rs               # All Tauri commands (CRUD, process, download, SLP)
    ├── models.rs                 # Shared data types (ServerConfig, events, etc.)
    ├── state.rs                  # AppState: process handles map + data directory
    └── lib.rs                    # Tauri builder and command registration
```

---

## Supported server types

| Type | Download source | Installation |
|------|-----------------|--------------|
| **Vanilla** | Mojang launcher manifest API | Downloads `server.jar` directly |
| **Paper** | api.papermc.io (latest build) | Downloads the Paper jar directly |
| **Fabric** | meta.fabricmc.net | Downloads a self-contained server launcher jar |
| **Forge** | Forge promotions API + Maven | Downloads installer jar, runs it with `--installServer`, then launches via `run.bat` or `run.sh` |

Version lists for each type are fetched live at creation time from their respective APIs.

---

## Architecture

### Data storage

Server configurations are stored at:

```
{app_data_dir}/launchstone/servers/{uuid}/launchstone.json
```

Each server UUID maps to a directory that holds its jar, `eula.txt`, `server.properties`, world data, and any other files generated at runtime.

### Process management

Running servers are tracked in `AppState.processes`, a `HashMap<String, ProcessHandle>` behind an `Arc<Mutex<...>>`. Each handle holds:

- A locked `stdin` for sending commands
- A `Mutex<ServerStatus>` for the current lifecycle state
- A `Mutex<(u32, u32)>` for the current/max player counts

### Event system

The backend emits three Tauri event types to the frontend:

| Event | Payload | Description |
|-------|---------|-------------|
| `server-log` | `LogEvent` | One line of stdout/stderr with a parsed level (INFO, WARN, ERROR) |
| `server-status` | `StatusEvent` | Status transition with current player counts |
| `download-progress` | `DownloadProgress` | Bytes downloaded, total bytes, and a status message |

The frontend subscribes to these events per server ID so multiple server views stay independent.

### Server List Ping

Player data is fetched using a hand-rolled implementation of the [Minecraft Server List Ping protocol](https://wiki.vg/Server_List_Ping) over a raw TCP connection. The query runs with a 3-second timeout and updates the player count in `AppState` on success.

### Java discovery

The backend checks `JAVA_HOME` first, then falls back to `java` on `PATH`. Forge uses a separate Java invocation to run its installer before the server itself starts.

---

## Tauri commands

All commands are registered in `lib.rs` and implemented in `commands.rs`.

| Command | Description |
|---------|-------------|
| `get_minecraft_versions` | Fetch available versions for a given server type |
| `list_servers` | Return all configured servers with live status |
| `create_server` | Download server files and write config |
| `delete_server` | Stop the server if running, then remove its directory |
| `start_server` | Spawn the Java process and begin streaming logs |
| `stop_server` | Send `stop\n` to the server's stdin |
| `restart_server` | Stop, wait for exit, then start again |
| `send_command` | Write an arbitrary command to stdin |
| `get_server_status` | Poll current status and player counts |
| `query_players` | Ping the server via SLP and return the player sample |
| `list_server_files` | List files and directories within a server's folder |
| `read_server_file` | Read a file's text content |
| `write_server_file` | Overwrite a file's text content |
| `delete_server_file` | Delete a file or directory |
| `open_server_file` | Open a file or folder with the system default application |

Path traversal is prevented on all file commands by canonicalizing both the server root and the requested path and verifying that the latter is a child of the former.

---

## Design system

| Token | Value | Usage |
|-------|-------|-------|
| `--color-orange-primary` | `#f97316` | Buttons, active tabs, accents |
| Surface 0 | `#0d0e11` | Deepest background (editor textarea) |
| Surface 1 | `#15171c` | Cards, modals |
| Surface 2 | `#1e2128` | Inputs, secondary backgrounds |
| Surface 3 | `#252830` | Hover states, badges |

Font: Inter (loaded from Google Fonts). Monospace areas use JetBrains Mono, Fira Code, or Consolas as fallbacks.

The overall layout is inspired by Modrinth's server panel.

---

## Known quirks

- **`crate-type` must stay as `["rlib"]`** in `Cargo.toml`. Adding `cdylib` causes an `export ordinal too large` linker error under GNU ld (65535 ordinal limit). `cdylib` is only required for Android targets.
- **MSVC toolchain is not supported** on this machine. If you have Visual Studio Build Tools installed on a different machine you could switch to `stable-x86_64-pc-windows-msvc`, but this project is configured for GNU.
- **Forge installation can take a minute** on first run while the installer downloads its own dependencies. The UI shows installer log lines in the progress display during this phase.
- **`online-mode` is set to `false`** in the generated `server.properties`. Change this manually after creation if you want authentication against Mojang accounts.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Tauri 2 |
| Frontend | React 19, TypeScript, Vite 7, Tailwind v4 |
| Backend | Rust (stable, GNU toolchain) |
| Async runtime | Tokio |
| HTTP client | reqwest |
| Routing | react-router-dom v7 |
| Icons | lucide-react |
