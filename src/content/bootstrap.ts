import { PANEL_ROOT_ID } from '../shared/constants/index.js';
import { selectorsFor } from '../shared/constants/selectors.js';
import { delay } from '../shared/utils/index.js';
import type {
  RuntimeMessage,
  MessageResponse,
  ContentState,
} from '../shared/types/index.js';
import { PanelComponent } from '../ui/components/panel.component.js';
import { ThemeManager } from '../ui/styles/theme-manager.js';
import { buildContentApp } from './composition-root.js';
import type { AppController } from './app-controller.js';

async function main(): Promise<void> {
  // Guard against double-injection (Telegram can re-run scripts on soft nav).
  if (document.getElementById(PANEL_ROOT_ID)) return;

  const { container, controller, detection } = await buildContentApp();
  const logger = container.resolve('logger').child('bootstrap');

  if (!detection.supported) {
    logger.warn(`Unsupported page: ${detection.reason ?? 'unknown'}`);
    return; // Fallback: do nothing on non-Telegram pages.
  }
  if (!detection.loggedIn) {
    logger.info('Telegram detected but user not logged in; awaiting login.');
  }
  logger.info(controller.i18n.t('notice_detected', { client: detection.client }));

  const settings = await container.resolve('storage').getSettings();
  const selectors = selectorsFor(detection.client);

  // Observe a STABLE ancestor (it survives chat switches), not the message
  // container itself (which Telegram re-creates per chat). Falls back to body.
  const observeRoot = await waitForElement(selectors.observeRoot, 8000);
  if (!observeRoot) {
    logger.warn('Observe root not found within timeout; falling back to body.');
  }

  const panel = new PanelComponent();
  panel.viewModel = controller;
  await restorePanelState(panel, container);
  mountPanel(panel, settings.theme, container);

  controller.start(observeRoot ?? document.body);
  registerKeyboardShortcuts(controller, panel);
  registerMessageListener(controller, panel, detection.client);

  logger.info('Telegram Media Downloader ready.');
}

function mountPanel(
  panel: PanelComponent,
  theme: Parameters<ThemeManager['apply']>[0],
  container: Awaited<ReturnType<typeof buildContentApp>>['container'],
): void {
  panel.host.id = PANEL_ROOT_ID;

  const themeManager = new ThemeManager(panel.host);
  themeManager.apply(theme);

  document.body.appendChild(panel.host);
  panel.connect();
  container.resolve('logger').child('ui').debug('Panel mounted');
}

async function restorePanelState(
  panel: PanelComponent,
  container: Awaited<ReturnType<typeof buildContentApp>>['container'],
): Promise<void> {
  const storage = container.resolve('storage');
  const state = await storage.getPanelState();
  panel.configure(state, (next) => void storage.savePanelState(next));
}

function registerKeyboardShortcuts(
  controller: AppController,
  panel: PanelComponent,
): void {
  window.addEventListener(
    'keydown',
    (event) => {
      if (!panel.isVisible) return;
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;

      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'a' &&
        !typing
      ) {
        event.preventDefault();
        controller.selectAllVisible();
      } else if (event.key === 'Escape') {
        if (controller.getSelectedIds().length > 0) {
          controller.clearSelection();
        }
      }
    },
    true,
  );
}

function registerMessageListener(
  controller: AppController,
  panel: PanelComponent,
  client: string,
): void {
  chrome.runtime.onMessage.addListener(
    (message: RuntimeMessage, _sender, sendResponse: (r: MessageResponse) => void) => {
      switch (message.type) {
        case 'PING':
          sendResponse({ ok: true });
          return false;
        case 'TOGGLE_PANEL':
          panel.toggleVisible();
          sendResponse({ ok: true });
          return false;
        case 'START_SCAN':
          controller.rescan();
          sendResponse({ ok: true });
          return false;
        case 'GET_STATE': {
          const state: ContentState = {
            detected: true,
            client,
            totalMedia: controller.getStatistics().total,
            selected: controller.getSelectedIds().length,
          };
          sendResponse({ ok: true, data: state });
          return false;
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message' });
          return false;
      }
    },
  );
}

async function waitForElement(
  selector: string,
  timeoutMs: number,
): Promise<Element | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = document.querySelector(selector);
    if (el) return el;
    await delay(150);
  }
  return document.querySelector(selector);
}

void main().catch((error) => {
  // Last-resort guard so a startup failure never breaks the host page.
  console.error('[tg-media-downloader] fatal bootstrap error', error);
});
