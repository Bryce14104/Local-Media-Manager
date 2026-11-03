# Shelf

Shelf is a local-first media library for Windows, macOS, and Linux. It indexes photos and videos that already live on the computer. Metadata goes into a SQLite file on that machine. The media files stay where they are, and nothing is uploaded.

The desktop shell is [Tauri 2](https://tauri.app/). The backend is Rust. The interface is React, TypeScript, and Tailwind CSS.

## Layout

```text
src/                          React UI
src/components/               Library, scan, and storage screens
src/lib/api.ts                Tauri commands used by the UI
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

That page is the interface. A normal browser tab cannot open the native folder dialog or the SQLite file. Use the desktop shell for that:

```bash
npm run tauri dev
```

`npm run tauri dev` starts Vite and opens the Shelf window. Choose **Scan**, browse to a folder, and the library fills from `library.sqlite` in the operating system’s app-data directory.

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
