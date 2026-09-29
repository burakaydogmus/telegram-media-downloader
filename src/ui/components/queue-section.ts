import { BaseComponent, type Changes } from './base-component.js';
import type { PanelEvent } from './panel-view-model.js';
import type { DownloadTask, DownloadState } from '../../shared/types/index.js';
import { TAGS } from '../../shared/constants/index.js';
import { createElement, formatBytes } from '../../shared/utils/index.js';
import { icon } from '../icons/svg-icons.js';
import type { TranslationKey } from '../../shared/i18n/index.js';
import { reconcileKeyed, setAttr, setHidden, setStyle, setText } from './dom-diff.js';

const STATE_LABELS: Readonly<Record<DownloadState, TranslationKey>> = {
  queued: 'queue_state_queued',
  running: 'queue_state_running',
  completed: 'queue_state_completed',
  failed: 'queue_state_failed',
  cancelled: 'queue_state_cancelled',
};

interface TaskRow {
  readonly el: HTMLElement;
  readonly name: HTMLElement;
  readonly state: HTMLElement;
  readonly progress: HTMLElement;
  readonly bar: HTMLElement;
  readonly bytes: HTMLElement;
  readonly actions: HTMLElement;
  readonly retry: HTMLButtonElement;
  readonly cancel: HTMLButtonElement;
  readonly error: HTMLElement;
}

export function supportsDirectoryPicker(): boolean {
  return (
    typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker ===
    'function'
  );
}

function percent(progress: number): number {
  return Math.round(Math.min(Math.max(progress, 0), 1) * 100);
}

export class QueueSection extends BaseComponent {
  private readonly rowEls = new Map<string, HTMLElement>();
  private readonly rows = new WeakMap<HTMLElement, TaskRow>();
  private list: HTMLElement | null = null;
  private empty: HTMLElement | null = null;
  private summary: HTMLElement | null = null;
  private pauseBtn: HTMLButtonElement | null = null;
  private pausedNotice: HTMLElement | null = null;
  private overall: HTMLElement | null = null;
  private overallBar: HTMLElement | null = null;
  private folder: {
    readonly el: HTMLElement;
    readonly status: HTMLElement;
    readonly pick: HTMLButtonElement;
    readonly clear: HTMLButtonElement;
  } | null = null;

  constructor() {
    super(TAGS.queue);
  }

  protected override get observedChannels(): readonly PanelEvent[] {
    return ['queue', 'progress', 'settings'];
  }

  protected override build(): void {
    const { t } = this.vm.i18n;
    this.rowEls.clear();

    const button = (
      text: string,
      className: string,
      onClick: () => void,
    ): HTMLButtonElement =>
      createElement('button', { className, text, attrs: { type: 'button' }, onClick });

    this.summary = createElement('div', { className: 'muted' });
    this.pauseBtn = button('', 'btn', () => {
      if (this.vm.getQueueSnapshot().paused) this.vm.resumeQueue();
      else this.vm.pauseQueue();
    });

    const controls = createElement('div', {
      className: 'row',
      children: [
        button(t('queue_start'), 'btn', () => this.vm.startQueue()),
        this.pauseBtn,
        button(t('queue_clear_finished'), 'btn', () => this.vm.clearFinishedTasks()),
        button(t('queue_cancel_all'), 'btn btn--danger', () =>
          this.vm.cancelAllDownloads(),
        ),
      ],
    });

    this.pausedNotice = createElement('div', {
      className: 'notice',
      attrs: { role: 'status' },
    });

    this.list = createElement('div', {
      className: 'queue-list',
      attrs: { role: 'list' },
    });
    this.empty = createElement('div', { className: 'empty', text: t('queue_empty') });

    this.overallBar = createElement('div', { className: 'progress__bar' });
    this.overall = createElement('div', {
      className: 'progress overall-progress',
      attrs: {
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-label': t('section_queue'),
      },
      children: [this.overallBar],
    });

    this.mount(
      createElement('section', {
        className: 'section',
        attrs: { 'aria-label': t('section_queue') },
        children: [
          createElement('h2', { className: 'section__title', text: t('section_queue') }),
          this.summary,
          controls,
          this.pausedNotice,
          this.buildFolderControl(),
          createElement('div', { className: 'gap-top' }),
          this.empty,
          this.list,
          this.overall,
        ],
      }),
    );
  }

  private buildFolderControl(): HTMLElement {
    const { t } = this.vm.i18n;
    const status = createElement('span', { className: 'muted folder__status' });
    const pick = createElement('button', {
      className: 'btn btn--small',
      attrs: { type: 'button' },
      children: [icon('folder', 14), createElement('span')],
    });
    // Must run synchronously inside the click: the picker needs a user gesture.
    pick.addEventListener('click', () => {
      pick.disabled = true;
      this.vm
        .pickDownloadDirectory()
        .catch(() => false)
        .finally(() => {
          pick.disabled = false;
          this.requestUpdate('local');
        });
    });
    const clear = createElement('button', {
      className: 'btn btn--small',
      text: t('folder_clear'),
      attrs: { type: 'button' },
    });
    clear.addEventListener('click', () => {
      this.vm
        .clearDownloadDirectory()
        .catch(() => undefined)
        .finally(() => this.requestUpdate('local'));
    });
    const el = createElement('div', {
      className: 'folder',
      attrs: { role: 'group', 'aria-label': t('folder_label') },
      children: [
        createElement('div', { className: 'folder__label', text: t('folder_label') }),
        status,
        createElement('div', { className: 'row', children: [pick, clear] }),
      ],
    });
    this.folder = { el, status, pick, clear };
    return el;
  }

  protected override update(changes: Changes): void {
    const snapshot = this.vm.getQueueSnapshot();
    const onlyProgress =
      changes !== null && changes.size === 1 && changes.has('progress');

    if (onlyProgress) {
      for (const task of snapshot.tasks) {
        const el = this.rowEls.get(task.id);
        const row = el ? this.rows.get(el) : undefined;
        if (row) this.patchProgress(row, task);
      }
    } else {
      this.updateControls(snapshot.paused, snapshot.pauseReason);
      this.updateFolder();
      if (this.list && this.empty) {
        setHidden(this.empty, snapshot.tasks.length > 0);
        reconcileKeyed(
          this.list,
          snapshot.tasks,
          (task) => task.id,
          this.rowEls,
          (task) => this.createRow(task),
          (el, task) => {
            const row = this.rows.get(el);
            if (row) this.patchRow(row, task);
          },
        );
      }
    }

    const { t } = this.vm.i18n;
    if (this.summary) {
      setText(
        this.summary,
        t('queue_progress', { done: snapshot.completed, total: snapshot.total }),
      );
    }
    if (this.overall && this.overallBar) {
      const value = percent(snapshot.overallProgress);
      setAttr(this.overall, 'aria-valuenow', String(value));
      setStyle(this.overallBar, 'width', `${value}%`);
    }
  }

  private updateControls(paused: boolean, reason: string | undefined): void {
    const { t } = this.vm.i18n;
    if (this.pauseBtn) {
      setText(this.pauseBtn, paused ? t('queue_resume') : t('queue_pause'));
      setAttr(this.pauseBtn, 'aria-pressed', String(paused));
    }
    if (this.pausedNotice) {
      setHidden(this.pausedNotice, !paused);
      setText(
        this.pausedNotice,
        reason ? t('queue_paused_reason', { reason }) : t('queue_paused'),
      );
    }
  }

  private updateFolder(): void {
    const folder = this.folder;
    if (!folder) return;
    const supported = supportsDirectoryPicker();
    setHidden(folder.el, !supported);
    if (!supported) return;
    const { t } = this.vm.i18n;
    const has = this.vm.hasDownloadDirectory();
    setText(folder.status, has ? t('folder_set') : t('folder_unset'));
    const label = folder.pick.lastElementChild;
    if (label) setText(label, has ? t('folder_change') : t('folder_pick'));
    setHidden(folder.clear, !has);
  }

  private createRow(task: DownloadTask): HTMLElement {
    const { t } = this.vm.i18n;
    const name = createElement('span', { className: 'queue-item__name' });
    const state = createElement('span', { className: 'queue-item__state' });
    const bar = createElement('div', { className: 'progress__bar' });
    const progress = createElement('div', {
      className: 'progress',
      attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' },
      children: [bar],
    });
    const bytes = createElement('span', { className: 'queue-item__bytes muted' });
    const retry = createElement('button', {
      className: 'icon-btn',
      attrs: { type: 'button', 'aria-label': t('queue_retry'), title: t('queue_retry') },
      children: [icon('retry', 14)],
      onClick: () => this.vm.retryTask(task.id),
    });
    const cancel = createElement('button', {
      className: 'icon-btn',
      attrs: {
        type: 'button',
        'aria-label': t('queue_cancel'),
        title: t('queue_cancel'),
      },
      children: [icon('cancel', 14)],
      onClick: () => this.vm.cancelTask(task.id),
    });
    const error = createElement('span', { className: 'muted queue-item__error' });
    const actions = createElement('div', { className: 'row queue-item__actions' });

    const el = createElement('div', {
      className: 'queue-item',
      attrs: { role: 'listitem' },
      dataset: { taskId: task.id },
      children: [
        createElement('div', { className: 'queue-item__top', children: [name, state] }),
        progress,
        actions,
      ],
    });
    this.rows.set(el, {
      el,
      name,
      state,
      progress,
      bar,
      bytes,
      actions,
      retry,
      cancel,
      error,
    });
    return el;
  }

  private patchRow(row: TaskRow, task: DownloadTask): void {
    const { t } = this.vm.i18n;
    const name = task.item.fileName ?? `${task.item.type}-${task.item.id}`;
    setText(row.name, name);
    setAttr(row.name, 'title', name);
    setText(row.state, t(STATE_LABELS[task.state]));
    const stateClass = `queue-item__state state--${task.state}`;
    if (row.state.className !== stateClass) row.state.className = stateClass;
    setAttr(row.progress, 'aria-label', name);

    // Keep a stable child order: [retry][cancel][bytes][error].
    const wanted: HTMLElement[] = [];
    if (task.state === 'failed' || task.state === 'cancelled') wanted.push(row.retry);
    if (task.state === 'queued' || task.state === 'running') wanted.push(row.cancel);
    wanted.push(row.bytes);
    if (task.error !== undefined) {
      setText(row.error, task.error);
      wanted.push(row.error);
    }
    const current = [...row.actions.children];
    if (current.length !== wanted.length || current.some((el, i) => el !== wanted[i])) {
      for (const el of current) if (!wanted.includes(el as HTMLElement)) el.remove();
      wanted.forEach((el, i) => {
        if (row.actions.children[i] !== el) {
          row.actions.insertBefore(el, row.actions.children[i] ?? null);
        }
      });
    }
    this.patchProgress(row, task);
  }

  private patchProgress(row: TaskRow, task: DownloadTask): void {
    const value = percent(task.progress);
    setStyle(row.bar, 'width', `${value}%`);
    setAttr(row.progress, 'aria-valuenow', String(value));
    setText(row.bytes, this.bytesLabel(task));
  }

  private bytesLabel(task: DownloadTask): string {
    const received = task.bytesReceived;
    const total = task.totalBytes;
    if (total !== undefined && total > 0) {
      return this.vm.i18n.t('queue_bytes', {
        received: formatBytes(received ?? 0),
        total: formatBytes(total),
      });
    }
    return received !== undefined && received > 0 ? formatBytes(received) : '';
  }
}
