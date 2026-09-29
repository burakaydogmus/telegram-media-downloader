# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Media grid** in the panel: virtualized thumbnails, click / Shift+click range
  selection, keyboard navigation, "downloaded" badges, reveal-in-chat.
- **Scan whole chat**: controlled upward auto-scroll with pause/resume/stop,
  "until date", IndexedDB checkpoints, and optional download-while-scanning.
- **Real download tracking**: the service worker matches Telegram-originated
  downloads, renames them with a **file-name template** (sub-folders, tokens
  `{chat} {peer} {date} {time} {msgId} {index} {type} {name} {ext}`) and reports
  real progress/completion/failure.
- **Download history** (IndexedDB): skip already-downloaded items, hide them in
  the view.
- **Save folder** (File System Access API): large files stream straight to disk.
- **Account safety**: serial native downloads with configurable delay + jitter;
  queue pause/resume and auto-pause on Telegram flood errors.
- **Scope filter** (this chat / all chats) and "hide downloaded".
- **Selector self-test** with warnings in the panel and popup; live smoke e2e
  (opt-in via `TGMD_LIVE=1`).
- New options: delay, jitter, template (with live preview), native photos,
  large-file threshold, skip downloaded, download while scanning.

### Fixed

- Mutation bursts larger than the batch size were silently dropped.
- Retries had no backoff; cancel→retry could run a task twice.
- Download progress never reached the UI.
- Ctrl+A in the panel's search box selected all media (shadow-DOM retargeting).
- Escape propagated to Telegram and closed the open chat.
- Option changes only applied after reloading Telegram.
- Concurrent statistics updates lost increments; failed→retried→completed
  tasks stayed counted as failed.
- The same media was registered several times (URL-based ids); lazy-loaded
  URLs were never picked up; video posters were counted as photos.
- Album items downloaded the album's first item; photos were saved at preview
  resolution; the download menu item was detected by UI language.
- Web K dates were not read (timestamp is on the bubble), breaking date filters.
- The extension removed Telegram-owned menu DOM nodes.
- `parseSizeLabel` thousands separators; `sanitizeFileName` cut extensions and
  allowed Windows reserved names; CSV lacked a BOM and `\t`/`\r` guards.
- Filter reset was not persisted; the panel could stay off-screen after resize.

## [1.0.0] - 2026-06-19

Initial production-ready release.

### Added

- **Telegram detection** for Web K and Web A, with environment, login, and DOM
  readiness checks plus fallback handling.
- **Media discovery** for photos, videos, GIFs, documents, and audio with
  incremental, duplicate-free scanning and fast indexing.
- **Centralized media registry** with O(1) add/get/remove/update and per-type
  indexes.
- **Selection system**: single, multi, select-all-visible, and clear, with
  `Ctrl/Cmd+A` and `Esc` keyboard shortcuts.
- **Download queue** with concurrency control, retry-with-backoff, progress
  tracking, and cancellation (`queued/running/completed/failed/cancelled`),
  executed via the background service worker and `chrome.downloads`.
- **Search** with fuzzy and partial matching across file name, type, and date.
- **Filtering** by media type and by Today / This Week / This Month.
- **Reporting**: CSV (RFC-4180 escaping with formula-injection hardening) and
  JSON export of the current view.
- **Floating panel** UI (native Web Components in Shadow DOM): Statistics,
  Search, Filters, Selection, Download Queue, and Logs sections; draggable,
  collapsible, and position-persistent.
- **Theming** via CSS variables: Light, Dark, and automatic Telegram-theme
  adaptation.
- **Internationalization** for English and Turkish with a runtime catalog and
  `_locales` manifest strings.
- **Accessibility**: keyboard navigation, ARIA labels, and screen-reader support
  targeting WCAG AA.
- **Centralized error handling** (`UIError`, `NetworkError`, `ScanError`,
  `DownloadError`, `StorageError`) with user messages and developer logs.
- **Logging** with `debug/info/warn/error` levels to console and a bounded
  in-memory buffer surfaced in the Logs panel.
- **Persistence** of settings, filters, UI state, and statistics via
  `chrome.storage.local`.
- **Options page** for auto scan, theme, language, logging level, and queue size.
- **Mutation engine** with debouncing, batching, and subtree de-duplication to
  avoid full rescans on large chats.
- **Tooling**: Vite (two-pass build for module + IIFE content script), strict
  TypeScript, ESLint (with security rules), Prettier, Vitest (90%+ coverage
  thresholds), and Playwright E2E tests.
- **Documentation**: README, ARCHITECTURE, CONTRIBUTING, CHANGELOG, and product
  screenshots.

[Unreleased]: https://example.com/compare/v1.0.0...HEAD
[1.0.0]: https://example.com/releases/tag/v1.0.0
