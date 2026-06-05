# Launchstone

Minecraft Java Edition server manager — Tauri 2 desktop app.

## Running the app

**This machine does not have MSVC build tools.** Rust must use the GNU toolchain (already configured via `rust-toolchain.toml` and `.cargo/config.toml`). Before running any `cargo` or `npm run tauri` command, MSYS2 ucrt64 must be in PATH so `windres` resolves correctly:

```powershell
$env:PATH = "C:\msys64\ucrt64\bin;" + $env:PATH
npm run tauri dev
```

Or open the terminal from within MSYS2 where ucrt64 is already on PATH.

## Project structure

```
src/                        # React frontend
  components/
    CreateServerModal.tsx   # 4-step wizard: name → type → version → port/RAM
    ServerCard.tsx          # Card on dashboard with start/stop/delete
    Sidebar.tsx             # Left nav
    StatusBadge.tsx         # Running/Stopped/Starting/Stopping indicator
  lib/
    tauri.ts                # Typed wrappers around invoke()
  pages/
    Home.tsx                # Dashboard grid of server cards
    ServerView.tsx          # Console + Players tabs for a single server
  types.ts                  # Shared TypeScript types

src-tauri/src/
  commands.rs               # All Tauri commands (CRUD, process, download, SLP query)
  models.rs                 # Rust data types (ServerConfig, ServerStatus, events)
  state.rs                  # AppState: process handles map + data_dir
  lib.rs                    # Tauri builder, command registration
```

## Architecture notes

- Server configs are stored as `{app_data_dir}/launchstone/servers/{id}/launchstone.json`
- Each server gets its own subdirectory with its jar, eula.txt, server.properties, worlds, etc.
- Server processes are managed in `AppState.processes` (Arc<Mutex<HashMap>>)
- Stdout is streamed line-by-line via `server-log` Tauri events; status changes via `server-status` events
- Download progress emitted via `download-progress` events
- Player list uses the Minecraft Server List Ping (SLP) TCP protocol on the server's port

## Supported server types

| Type    | Download source                  | Notes                              |
|---------|----------------------------------|------------------------------------|
| Vanilla | Mojang launcher manifest API     | Direct jar download                |
| Paper   | api.papermc.io — latest build    | Direct jar download                |
| Fabric  | meta.fabricmc.net                | Self-contained server launcher jar |
| Forge   | Forge promotions API + installer | Runs installer, then detects run.bat/run.sh |

## Toolchain

- **Rust**: `stable-x86_64-pc-windows-gnu` (pinned in `rust-toolchain.toml`)
- **Linker**: `x86_64-w64-mingw32-gcc` from MSYS2 (set in `.cargo/config.toml`)
- **Frontend**: Vite + React 18 + TypeScript + Tailwind v4

## Design

- Dark surfaces: `#0d0e11` / `#15171c` / `#1e2128`
- Accent: orange `#f97316` — defined as `--color-orange-primary` in `src/App.css`
- Layout inspired by Modrinth's server panel
- Font: Inter (loaded from Google Fonts in `index.html`)
