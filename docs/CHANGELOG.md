# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

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
