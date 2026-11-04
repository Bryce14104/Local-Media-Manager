# Shelf

Shelf is a local-first media library for Windows, macOS, and Linux. It indexes photos and videos that already live on the computer. Metadata goes into a SQLite file on that machine. The media files stay where they are, and nothing is uploaded.

The desktop shell is [Tauri 2](https://tauri.app/). The backend is Rust. The interface is React, TypeScript, and Tailwind CSS.

## Layout

```text
src/                          React studio
src/studio/                   Mock catalog, filters, and workspace state
src/components/               Command bar, grids, inspector, and dialogs
src/lib/api.ts                Tauri commands kept for the Rust catalog
src-tauri/src/lib.rs          App startup. Opens library.sqlite.
src-tauri/src/commands.rs     Commands the UI can call
src-tauri/src/db/schema.sql   SQLite initialization script
src-tauri/src/db/mod.rs       Opens the database and reads or writes rows
src-tauri/src/services/       Folder scanning, hashing, and EXIF
src-tauri/Cargo.toml          Rust dependencies
```

`schema.sql` creates `media_files` with the path, SHA-256 hash, file size, timestamps, and rating. Shelf applies that script whenever the database opens.

Scanning uses `walkdir`. `jwalk` is the faster parallel walker, but its 0.9 release is marked unmaintained, so this project stays on `walkdir`. EXIF comes from `kamadak-exif`. SQLite is bundled through `rusqlite`, so the app does not need a system SQLite library.

## Prerequisites

- Node.js 22 or newer
- npm
- Rust stable, 1.90 or newer (the Tauri dialog plugin asks for 1.90)
- The Tauri system packages for your OS: <https://tauri.app/start/prerequisites/>

On Linux that includes `libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev`, `librsvg2-dev`, and `patchelf`. The prerequisites page has the current package list for Ubuntu, Fedora, and Arch.

## Commands

Run these from the repository root in the integrated terminal.

Install the frontend and download the Tauri CLI:

```bash
npm install
```

The first Cargo command also downloads the Rust crates, including `rusqlite`, `walkdir`, `serde`, and `serde_json`.

Test the catalog, the scanner, and EXIF reading:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Typecheck and build the frontend:

```bash
npm run build
```

Check that the Rust crate compiles:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Start the Vite UI on <http://127.0.0.1:1420>:

```bash
npm run dev
```

That page is the studio. The grid, command palette, inspector, map, and telemetry run on a mock catalog, so the layout can be tried in a browser. Press Ctrl+K or Cmd+K to filter. `type:raw`, `rating:>=4`, `camera:`, and `date:2026-03` are the filter forms. Map, in the view switcher or the layout presets, plots each frame from its mock GPS fix. A thumbnail tray along the bottom stays in step with the pins: choose a frame to center its pin, or choose a pin to highlight its frame. Drag a region or click a cluster to filter the grid. Preferences downloads a named or custom region at a maximum zoom you choose, from overview through street detail, and stores those Esri dark-basemap tiles in this browser. Tiles are requested only when you start the download.

```bash
npm run tauri dev
```

`npm run tauri dev` opens the same studio in a desktop window. The Rust catalog in `src-tauri` still creates `library.sqlite` on launch. The studio screen does not read that file yet.

`npm run test:rust` and `npm run check:rust` are the same Cargo commands as above.

## What a scan stores

For each JPEG, PNG, HEIC, common raw file, and video under the folder, Shelf stores:

- the absolute path
- a SHA-256 of the file bytes
- the size in bytes
- creation and modification times, as unix seconds
- the time the row was written
- an optional rating from 0 to 5
- `image`, `video`, or `raw`
- a small JSON document of EXIF fields, when the file has them

Hidden names are skipped. Symbolic links are not followed. A later scan leaves a file alone when the size and modification time are unchanged, and it does not clear the rating.
