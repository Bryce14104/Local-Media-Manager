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

Scanning uses `walkdir`. EXIF comes from `kamadak-exif`. SQLite is bundled through `rusqlite`. Visual tags and search use CLIP ViT-B/32 (ONNX Runtime) on this machine. Optional YuNet/SFace models download on first face pass. Previews stay when a drive unplugs; originals are used in fullscreen when the volume is online.

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

The first Cargo command also downloads the Rust crates, including `rusqlite`, `walkdir`, `serde`, `serde_json`, and ONNX Runtime.

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

That page is the studio. The grid, command palette, inspector, map, and telemetry run on a mock catalog, so the layout can be tried in a browser. Press Ctrl+K or Cmd+K to filter. The search bar reads a sentence together with the older filter forms. `photos of Bryce with dogs`, `drone shots of wildlife`, `rating:>=4 sunset`, `lighthouse`, `beach`, `boat`, `cat`, and `water` each narrow the grid. `type:raw`, `camera:`, and `date:2026-03` still work. Compact, Timeline, Map, and AI Insights sit in the top bar, next to Browse, Inspect, and Compare. AI Insights reads the local `clusters`, `cluster_members`, and `media_captions` tables: short sequences become smart collections, scenes and objects become labeled clusters, and caption tags are searchable. Open a group to browse its frames, or send that set back to the grid. Name a person cluster, tick two and merge them, or split one face into its own identity. While Shelf indexes, embeds, clusters, or captions, a compact stage and percentage sit beside Preferences. The status bar slider scales the grid from large preview cards to a dense multi-column layout. Map opens centered on Australia, with the roll in a panel on the right: choose a frame to center its pin, or choose a pin to bring that frame into view. Drag a region or click a cluster to filter the roll. Preferences sets a maximum zoom, from overview through street detail, then Select area to cache lets you draw that box on the map. Shelf stores the Esri dark-basemap tiles for the box in this browser. Tiles are requested only when you start the download. The browser catalog already has the sample people and subject tags. The page does not run the vision models.

```bash
npm run tauri dev
```

`npm run tauri dev` opens the same studio in a desktop window. Add media uses the system folder picker. After a card preview, you can index in place, copy the new files to another folder and index that copy, or eject the volume. Preferences can export a travel pack (SQLite plus 720p previews) and open it on another machine. Video clips store duration, codec, and in/out marks (`I` / `O` in fullscreen); batch export can cut a subclip with ffmpeg. Online originals can write an `.xmp` sidecar next to the file. Shelf scans that folder into `library.sqlite`, reads each file's EXIF or XMP capture time, and sorts the grid by that time. GPS latitude and longitude from the same metadata place the map pin. The status bar shows a percentage while the folder is indexed, while previews are written, and while the local vision pass reads faces and subjects. The terminal running `npm run tauri dev` prints a line as each file is cataloged, as its pixels are analyzed, and when the visual tags are stored. The search bar has an AI Search switch. On, the desktop app runs CLIP ViT-B/32 through ONNX Runtime, stores a 512-number vector per still, and ranks the library against the sentence. Tags, GPS place names, and structured tokens (`type:raw`, `date:2026-03`) combine with AND. Off, leftover words match file names and paths only. If CLIP cannot load, startup prints `CRITICAL ort initialization failed`. A background job writes a small JPEG preview for JPEG and RAW files into the app-data `thumbnails` folder, then the cards pick those up. After the previews, CLIP tags scenes and objects. YuNet and SFace (OpenCV zoo, downloaded on first use) group faces when the models are available. A seashore becomes beach and water, a speedboat becomes boat, a beacon becomes lighthouse, and buildings and cars become architecture and vehicle, so those words filter the grid. A warm sky in the top of the frame is tagged sunset. A camera make or model that names a drone is tagged drone. Boxes, vectors, person clusters, and tags are stored in SQLite. Naming, merging, and splitting a person updates those rows. There is no network call and no outside identity database. The recognition is only for the library on this computer. Clicking a card opens a full-screen viewer on the larger preview. Arrow keys and the side controls move through the current grid, and Escape or Close returns to that frame in the grid. Ctrl-click or Cmd-click toggles a frame, Shift-click selects the range from the last click, and Ctrl+A or Cmd+A selects every visible frame. Escape clears the selection. Select still switches the grid into checkbox mode. The toolbar can flag the selection, remove it from the catalog, or delete cataloged files after a confirmation. A path that is not in the library is left on disk. In a browser preview, Browse Folders uses the page's folder picker, reads the same dates, GPS, and embedded previews in the page, and adds those files to the grid without writing SQLite.

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
- a small JSON document of EXIF fields, including GPS latitude and longitude when the file has them
- a pick or reject flag, when one has been set

Hidden names are skipped. Symbolic links are not followed. A later scan leaves a file alone when the size and modification time are unchanged, and it does not clear the rating.





Copyright © 2026 Bryce. All rights reserved. Source code is visible for transparency during the public beta; redistribution or commercial use is not permitted.
