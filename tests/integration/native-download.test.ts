import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NativeDownloadTrigger } from '../../src/content/native-download.js';
import { NonRetryableDownloadError } from '../../src/features/download/index.js';
import type { MediaItem } from '../../src/shared/types/index.js';

function videoItem(messageId?: string): MediaItem {
  return {
    id: 'v1',
    type: 'video',
    ...(messageId ? { messageId } : {}),
  };
}

let menuHandler: ((event: Event) => void) | null = null;
function wireFakeTelegramMenu(opts: {
  withDownload: boolean;
  onDownloadClick?: () => void;
}): void {
  menuHandler = (): void => {
    const menu = document.createElement('div');
    menu.className = 'btn-menu';

    const other = document.createElement('div');
    other.className = 'btn-menu-item';
    other.textContent = 'Reply';
    menu.appendChild(other);

    if (opts.withDownload) {
      const download = document.createElement('div');
      download.className = 'btn-menu-item';
      const icon = document.createElement('span');
      icon.className = 'tgico-download';
      download.append(icon, document.createTextNode('Download'));
      download.addEventListener('click', () => {
        opts.onDownloadClick?.();
        menu.remove();
      });
      menu.appendChild(download);
    }

    document.body.appendChild(menu);
  };
  document.addEventListener('contextmenu', menuHandler);
}

describe('NativeDownloadTrigger (integration)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    if (menuHandler) {
      document.removeEventListener('contextmenu', menuHandler);
      menuHandler = null;
    }
  });

  it('finds the bubble and clicks Telegram\u2019s native Download item', async () => {
    document.body.innerHTML = `
      <div class="bubbles">
        <div class="bubble" data-mid="5001">
          <video class="media-video"></video>
        </div>
      </div>
    `;
    const clicked = vi.fn();
    wireFakeTelegramMenu({ withDownload: true, onDownloadClick: clicked });

    const trigger = new NativeDownloadTrigger('webk', document);
    await trigger.download(videoItem('5001'), new AbortController().signal);

    expect(clicked).toHaveBeenCalledOnce();
    // Menu is dismissed afterwards.
    expect(document.querySelector('.btn-menu')).toBeNull();
  });

  it('rejects (non-retryable) when the media is not on screen', async () => {
    document.body.innerHTML = '<div class="bubbles"></div>';
    const trigger = new NativeDownloadTrigger('webk', document);
    await expect(
      trigger.download(videoItem('9999'), new AbortController().signal),
    ).rejects.toBeInstanceOf(NonRetryableDownloadError);
  });

  it('rejects when Telegram exposes no download option', async () => {
    document.body.innerHTML = `
      <div class="bubble" data-mid="7">
        <video class="media-video"></video>
      </div>
    `;
    // Menu opens but without a download entry.
    wireFakeTelegramMenu({ withDownload: false });

    const trigger = new NativeDownloadTrigger('webk', document);
    await expect(
      trigger.download(videoItem('7'), new AbortController().signal),
    ).rejects.toBeInstanceOf(NonRetryableDownloadError);
  });
});
