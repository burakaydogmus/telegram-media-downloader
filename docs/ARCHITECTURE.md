# Architecture

This document describes the design of **Telegram Media Downloader**, an MV3
Chrome extension built with TypeScript, Vite, and native Web Components. The
guiding principles are **SOLID**, **DRY**, **KISS**, **dependency injection**,
and a **feature-based, modular** structure.

## 1. Execution contexts

A Chrome extension runs across several isolated JavaScript contexts. This
project maps cleanly onto them:

| Context                             | Entry point                        | Responsibility                                                       |
| ----------------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| **Content script** (isolated world) | `src/content/bootstrap.ts`         | Detect Telegram, scan the DOM, run the registry/queue, render panel. |
| **Service worker** (background)     | `src/background/service-worker.ts` | Perform `chrome.downloads`, relay logs, seed default settings.       |
| **Popup**                           | `src/popup/popup.ts`               | Quick status + actions (toggle panel, rescan, open settings).        |
| **Options page**                    | `src/options/options.ts`           | Edit and persist settings.                                           |

Because these contexts cannot share object references, they communicate through
**typed runtime messages** (`src/shared/types/messages.ts`).

```
┌───────────────┐   chrome.runtime / tabs    ┌──────────────────┐
│  Popup /      │ ─────────────────────────▶ │ Content script    │
│  Options      │ ◀───────────────────────── │ (panel + scanner) │
└───────────────┘                            └─────────┬────────┘
                                                       │ DOWNLOAD_FILE
                                                       ▼
                                             ┌──────────────────┐
                                             │ Service worker    │
                                             │ (chrome.downloads)│
                                             └──────────────────┘
```

## 2. Layered design

```
shared  ←  features  ←  content / ui   (dependencies point left → right consumes left)
```

- **`shared/`** — zero-dependency foundation: `types`, `constants`, `utils`,
  `logger`, `errors`, `i18n`, and a tiny `di` container. Nothing here imports
  from `features`, `content`, or `ui`.
- **`features/`** — framework-agnostic domain services, each in its own folder
  with a barrel `index.ts`: `download`, `selection`, `search`, `filter`,
  `reporting`, `local-storage`. They depend only on `shared`.
- **`content/`** — Telegram-specific orchestration: detector, scanner, registry,
  mutation engine, and the `AppController` that wires features together.
- **`ui/`** — presentation: web components, styles, icons, theming. The UI talks
  to the rest of the app **only** through the `PanelViewModel` interface.

This dependency direction keeps domain logic testable in isolation (no DOM, no
Chrome APIs) and makes the UI swappable.

## 3. Dependency injection

`src/shared/di/container.ts` is a minimal, type-safe IoC container supporting
singletons, transients, and values. The content script's
[`composition-root.ts`](../src/content/composition-root.ts) is the single place
where concrete implementations are registered and wired:

- Construction-time **circular dependency** between `MutationEngine` and
  `AppController` is broken by resolving the controller **lazily** inside the
  mutation handler closure (it's only needed at flush time, not construction).
- Tests build the same graph with in-memory fakes (e.g. `MemoryStorageDriver`),
  so no global mocking is required.

## 4. Content pipeline (the hot path)

```
TelegramDetector → MediaScanner → MediaRegistry → AppController → PanelViewModel → UI
                          ▲                                  │
                          └────────── MutationEngine ◀───────┘
```

1. **`TelegramDetector`** identifies Web K vs Web A, login state, and DOM
   readiness using centralized, client-specific selectors
   (`src/shared/constants/selectors.ts`). All brittle DOM knowledge lives here so
   Telegram markup changes are a one-file fix.
2. **`MediaScanner`** classifies media **per message** (album items get their
   own `albumIndex`), ignores stickers/viewers/the extension's own panel, and
   tracks seen elements in a `WeakSet` — it never writes to Telegram's DOM.
   Item ids come from `mediaKey(peer, message, albumIndex, type)`, never from
   URLs, so a blurred `data:` thumb upgrading to a `blob:` image is an
   **update**, not a duplicate. `scan()` returns `{ items, updates }`.
3. **`MediaRegistry`** stores items in a `Map` for **O(1)** add/get/remove/update
   and maintains per-type index sets for fast filtering. It emits
   `added/removed/updated/cleared` events via a `TypedEmitter`.
4. **`MutationEngine`** observes `childList` **and** `src/poster/style/href`
   attributes (lazy loading), debounces, de-duplicates roots in document order,
   and processes large bursts in idle-time chunks — nothing is dropped.
5. **`AppController`** subscribes to the registry, applies search/filters
   (scope = current chat via `peer.ts`, hide-downloaded via the history), manages
   selection, the download queue, the whole-chat crawler and live settings, and
   exposes a single reactive `PanelViewModel` to the UI. Channels: `queue` for
   state transitions, throttled `progress` for byte progress.

### Download pipeline

```
DownloadQueue ─▶ StrategyDownloadExecutor ─┬─ native: NativeDownloadTrigger (Telegram menu, serial + RateLimiter)
 (backoff,        (route per item/settings) ├─ direct: fetch same-origin blob / web.telegram.org
  pause/flood,                              │          ├─ large + folder ─▶ DirectoryWriter (stream to disk)
  dedupe)                                   │          └─ small ─▶ <a download="tgmd-<token>__…">
                                            └─ DownloadTracker ─ EXPECT_DOWNLOAD ─▶ service worker
                                                                ◀─ DOWNLOAD_UPDATE ─┘ (onDeterminingFilename
                                                                    renames to the template path; onChanged
                                                                    + polling report real progress/completion)
```

Completed downloads are recorded in an IndexedDB **download history**
(`DownloadHistory`), used for "skip already downloaded" and "hide downloaded".
The **ChatCrawler** scrolls a chat upward step by step (checkpointed in
IndexedDB); with `crawlAutoDownload` each step waits for the queue so native
downloads run while their messages are on screen. **`selector-health.ts`**
self-tests the selectors and surfaces failures in the panel and popup.

## 5. Features

| Feature         | Key type(s)                                                                                                         | Notes                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `download`      | `DownloadQueue`, `createDownloadExecutor`, `DownloadTracker`, `DirectoryWriter`, `RateLimiter`, `buildRelativePath` | Concurrency, exponential backoff, pause/flood auto-pause, dedupe, native vs direct routing, file-name templates, SW-tracked completion. |
| `selection`     | `SelectionService`                                                                                                  | Set-backed selection with toggle / select-only / select-all / clear / prune. Emits `change`.                                            |
| `search`        | `SearchService`                                                                                                     | Fuzzy + partial matching (`utils/fuzzy.ts`), ranked `SearchHit[]`.                                                                      |
| `filter`        | `FilterService`                                                                                                     | Type, date range, scope (current chat), hide downloaded.                                                                                |
| `reporting`     | `ReportService`                                                                                                     | CSV (RFC-4180 escaping + formula-injection hardening) and JSON.                                                                         |
| `local-storage` | `StorageService`, `DownloadHistory`, `IdbCrawlCheckpointStore`, `createPersistence`                                 | Serialized read-modify-write, live `onSettingsChanged`, IndexedDB with memory fallback.                                                 |

## 6. UI: Web Components without the global registry

A critical constraint: in a **content-script isolated world**, the page's
`customElements` registry is **not available**, so `customElements.define()`
can't be used. Instead, `src/ui/components/base-component.ts` implements a
component base that:

- creates its **own host element** (`document.createElement(tag)`),
- attaches a **Shadow DOM** for style/markup encapsulation,
- adopts constructable stylesheets (with a `<style>` fallback),
- provides `connect()/disconnect()` lifecycle hooks and `viewModel` injection.

`PanelComponent` composes the section components (Statistics, Search, Filters,
Selection, Queue, Logs), and implements dragging, collapsing, and viewport
clamping. The panel state (position/collapsed) is persisted via `StorageService`.

**Theming** uses CSS variables (`ui/styles/theme.ts`): Light, Dark, and an Auto
mode that adapts to Telegram's own theme. `ThemeManager` applies the variable set
to the panel host.

## 7. Cross-cutting concerns

- **Errors** — `shared/errors` defines an `AppError` base with a `category`
  (`UIError`, `NetworkError`, `ScanError`, `DownloadError`, `StorageError`), a
  user-facing message key, and developer context. UI shows the localized user
  message; the logger records the technical detail.
- **Logging** — `shared/logger` provides leveled logging (`debug/info/warn/error`)
  to both the console and a **bounded in-memory buffer** surfaced in the Logs
  panel. The buffer is capped to keep memory growth controlled.
- **i18n** — `shared/i18n` is a runtime catalog (`en`, `tr`) with interpolation
  and a `data-i18n` convention for static HTML (popup/options). Adding a language
  is a catalog entry plus a `_locales` folder.
- **Storage** — everything user-facing (settings, filters, panel state,
  statistics) persists through `chrome.storage.local` behind `StorageService`.

## 8. Security

- No `eval`, no `Function` constructor, no `javascript:` URLs (enforced by
  ESLint rules `no-eval`, `no-implied-eval`, `no-new-func`, `no-script-url`).
- All dynamic text is rendered with `textContent`; helpers in `utils/dom.ts`
  sanitize input and never use `innerHTML` for untrusted data.
- A strict **CSP** is declared in `manifest.json`; the content UI lives in a
  Shadow DOM to avoid leaking styles into (or from) the host page.

## 9. Build pipeline

Two Vite passes are required because contexts have different module semantics:

1. **`vite.config.ts`** builds the **module-type** entry points (service worker,
   popup, options) and copies static assets (`manifest.json`, `_locales`,
   `icons`).
2. **`vite.content.config.ts`** builds the **content script as an IIFE** library
   bundle (`emptyOutDir: false`), because MV3 content scripts can't load ESM
   chunks.

`npm run build` runs `tsc --noEmit` then both passes, producing a loadable
`dist/`.

## 10. Testing strategy

- **Unit** (Vitest + happy-dom): registry, queue, filter, search, selection,
  reporting, storage, logger, i18n, DI container, utils, errors, theme.
- **Integration**: DOM scanning (Web K & Web A fixtures), selection flow,
  controller actions, and UI section rendering.
- **E2E** (Playwright with the unpacked extension): extension loading, popup,
  options persistence, Telegram detection + panel injection, and queue
  operations against a local Telegram fixture.

Coverage thresholds are enforced at **90%+** (statements/functions/lines) in
`vitest.config.ts`.
