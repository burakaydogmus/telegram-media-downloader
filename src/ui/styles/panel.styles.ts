export const PANEL_STYLES = `
:host {
  display: block;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: var(--tgmd-fg);
}

* { box-sizing: border-box; }

.panel {
  width: 340px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--tgmd-bg);
  border: 1px solid var(--tgmd-border);
  border-radius: 12px;
  box-shadow: var(--tgmd-shadow);
  overflow: hidden;
}

.panel.collapsed .panel__body { display: none; }

.panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--tgmd-bg-elevated);
  border-bottom: 1px solid var(--tgmd-border);
  cursor: grab;
  user-select: none;
}
.panel__header:active { cursor: grabbing; }

.panel__title {
  font-weight: 600;
  font-size: 14px;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}
.panel__logo { width: 18px; height: 18px; display: inline-flex; }

.panel__body {
  overflow-y: auto;
  padding: 4px 0;
}

.icon-btn {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--tgmd-fg-muted);
  width: 28px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.icon-btn:hover { background: var(--tgmd-bg-hover); color: var(--tgmd-fg); }
.icon-btn:focus-visible { outline: 2px solid var(--tgmd-accent); outline-offset: 1px; }

.section {
  border-bottom: 1px solid var(--tgmd-border);
  padding: 10px 12px;
}
.section:last-child { border-bottom: none; }
.section__title {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--tgmd-fg-muted);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.stat {
  background: var(--tgmd-bg-elevated);
  border-radius: 8px;
  padding: 6px 8px;
  text-align: center;
}
.stat__value { font-size: 16px; font-weight: 700; }
.stat__label { font-size: 10px; color: var(--tgmd-fg-muted); }

.field {
  display: flex;
  gap: 6px;
  align-items: center;
}
.input {
  flex: 1;
  background: var(--tgmd-bg-elevated);
  border: 1px solid var(--tgmd-border);
  border-radius: 8px;
  color: var(--tgmd-fg);
  padding: 7px 10px;
  font-size: 13px;
}
.input:focus-visible { outline: 2px solid var(--tgmd-accent); outline-offset: 0; }

.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  appearance: none;
  border: 1px solid var(--tgmd-border);
  background: var(--tgmd-bg-elevated);
  color: var(--tgmd-fg);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.chip[aria-pressed='true'] {
  background: var(--tgmd-accent);
  color: var(--tgmd-accent-fg);
  border-color: var(--tgmd-accent);
}
.chip:focus-visible { outline: 2px solid var(--tgmd-accent); outline-offset: 1px; }

.btn {
  appearance: none;
  border: 1px solid var(--tgmd-border);
  background: var(--tgmd-bg-elevated);
  color: var(--tgmd-fg);
  border-radius: 8px;
  padding: 7px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn:hover { background: var(--tgmd-bg-hover); }
.btn:focus-visible { outline: 2px solid var(--tgmd-accent); outline-offset: 1px; }
.btn--primary {
  background: var(--tgmd-accent);
  color: var(--tgmd-accent-fg);
  border-color: var(--tgmd-accent);
}
.btn--danger { color: var(--tgmd-danger); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.row { display: flex; gap: 6px; flex-wrap: wrap; }
.row--between { justify-content: space-between; align-items: center; }
.muted { color: var(--tgmd-fg-muted); }

.queue-list, .log-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 180px;
  overflow-y: auto;
}
.queue-item {
  background: var(--tgmd-bg-elevated);
  border-radius: 8px;
  padding: 6px 8px;
}
.queue-item__top { display: flex; justify-content: space-between; gap: 8px; }
.queue-item__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.queue-item__state { font-size: 11px; }
.state--completed { color: var(--tgmd-success); }
.state--failed { color: var(--tgmd-danger); }
.state--running { color: var(--tgmd-accent); }
.state--cancelled { color: var(--tgmd-fg-muted); }

.progress {
  height: 4px;
  border-radius: 2px;
  background: var(--tgmd-bg-hover);
  margin-top: 4px;
  overflow: hidden;
}
.progress__bar { height: 100%; background: var(--tgmd-accent); width: 0%; transition: width 0.2s; }

.overall-progress { margin-top: 8px; }

.log-line { font-family: ui-monospace, monospace; font-size: 11px; }
.log-line--warn { color: var(--tgmd-warn); }
.log-line--error { color: var(--tgmd-danger); }
.log-line--debug { color: var(--tgmd-fg-muted); }

.empty { color: var(--tgmd-fg-muted); font-style: italic; padding: 8px 0; }
[hidden] { display: none !important; }
.gap-top { margin-top: 6px; }
.btn--small { padding: 4px 8px; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.error-text { color: var(--tgmd-danger); }

.toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.toggle input { accent-color: var(--tgmd-accent); margin: 0; }

.notice {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--tgmd-bg-elevated);
  color: var(--tgmd-warn);
  font-weight: 600;
}

.folder {
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--tgmd-bg-elevated);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.folder__label { font-weight: 600; }
.folder__status { font-size: 12px; }

.queue-item__actions { align-items: center; margin-top: 4px; }
.queue-item__bytes { font-size: 11px; }

.input--date { flex: 0 1 auto; padding: 4px 8px; }

.health {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  background: var(--tgmd-bg-elevated);
  border-bottom: 1px solid var(--tgmd-border);
  border-left: 3px solid var(--tgmd-warn);
}
.health__icon { color: var(--tgmd-warn); display: inline-flex; padding-top: 2px; }
.health__text { flex: 1; font-size: 12px; }
.health__checks { color: var(--tgmd-fg-muted); margin-top: 2px; }

.media-grid {
  position: relative;
  height: 248px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: 8px;
  background: var(--tgmd-bg-elevated);
  outline: none;
}
.media-grid__rows { position: relative; }
.media-grid__row {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 80px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding: 3px 6px;
  will-change: transform;
}
.tile {
  position: relative;
  overflow: hidden;
  border-radius: 6px;
  border: 2px solid transparent;
  background: var(--tgmd-bg-hover);
  cursor: pointer;
  user-select: none;
  outline: none;
  contain: strict;
}
.tile:focus-visible { box-shadow: 0 0 0 2px var(--tgmd-fg); }
.tile[aria-selected='true'] { border-color: var(--tgmd-accent); }
.tile[aria-selected='true']::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--tgmd-accent);
  opacity: 0.22;
  pointer-events: none;
}
.tile__icon {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tgmd-fg-muted);
}
.tile__thumb {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tile--noimg .tile__thumb { display: none; }
.tile__badge {
  position: absolute;
  left: 3px;
  max-width: calc(100% - 6px);
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 9px;
  line-height: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tile__type { top: 3px; }
.tile__size { bottom: 3px; max-width: calc(100% - 30px); }
.tile__done {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tgmd-success);
  color: #fff;
}
.tile__locate {
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
  opacity: 0;
}
.tile:hover .tile__locate,
.tile:focus-within .tile__locate { opacity: 1; }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
`;

export const PANEL_HOST_STYLES = `
:host {
  all: initial;
  display: block;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 2147483000;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: var(--tgmd-fg);
}
`;
