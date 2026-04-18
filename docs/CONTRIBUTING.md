# Contributing

Thanks for your interest in improving **Telegram Media Downloader**! This guide
explains how to set up the project, the conventions we follow, and how to get a
change merged.

## Prerequisites

- **Node.js >= 20** and npm.
- A Chromium-based browser for manual testing.

## Getting started

```bash
git clone <your-fork-url>
cd "telegram medya indirici"
npm install
npm run build      # produces dist/
```

Then load `dist/` as an unpacked extension (see the README's Installation
section). For an iterative loop use:

```bash
npm run dev        # rebuilds on change
```

Reload the extension from `chrome://extensions` (and refresh the Telegram tab)
to pick up changes.

## Project conventions

- **Language**: TypeScript in **strict** mode with
  `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. Avoid `any`;
  prefer precise types and discriminated unions.
- **No UI frameworks**: use native DOM APIs and the Web Component base in
  `src/ui/components/base-component.ts`.
- **Architecture**: keep the dependency direction `shared → features → content/ui`.
  Domain logic must not import from `content`/`ui`. New domain logic belongs in a
  feature folder with a barrel `index.ts`.
- **DI**: register new services in `src/content/composition-root.ts`; don't reach
  for module-level singletons.
- **DOM knowledge**: any Telegram selector goes in
  `src/shared/constants/selectors.ts` — nowhere else.
- **Security**: no `eval`/`Function`/`innerHTML` of untrusted data; render text
  via `textContent` and the helpers in `src/shared/utils/dom.ts`.
- **i18n**: user-facing strings go through the catalog
  (`src/shared/i18n/catalog.ts`) with both `en` and `tr` entries.

## Before you open a PR

Run the full local gate — all must pass:

```bash
npm run lint            # ESLint, zero warnings allowed
npm run format:check    # Prettier
npm run typecheck       # tsc --noEmit
npm run test:coverage   # Vitest, 90%+ thresholds
npm run test:e2e        # Playwright (run npm run build first)
```

Auto-fixers: `npm run lint:fix` and `npm run format`.

### Adding tests

- Put unit tests in `tests/unit`, integration tests in `tests/integration`, and
  E2E specs in `tests/e2e`.
- Reuse the factories in `tests/helpers/factories.ts`.
- New features must keep overall coverage at or above the configured thresholds.

## Commit & PR guidelines

- Use clear, imperative commit messages (e.g. `Add audio detection to scanner`).
- Conventional Commit prefixes (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`,
  `chore:`) are encouraged and help generate the changelog.
- Keep PRs focused and small where possible. Include:
  - what changed and **why**,
  - screenshots/GIFs for UI changes,
  - notes on any selector or manifest changes.
- Update `docs/CHANGELOG.md` under an **Unreleased** heading.

## Reporting bugs

Open an issue with: browser + version, Telegram client (Web K/A), reproduction
steps, expected vs actual behavior, and relevant logs (set **Logging level** to
`debug` in Settings to capture detail in the panel's Logs section).

## Code of conduct

Be respectful and constructive. Assume good intent, and keep discussions focused
on the work.
