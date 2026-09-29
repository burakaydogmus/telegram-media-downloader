import { PANEL_ROOT_ID } from '../shared/constants/index.js';
import { selectorsFor } from '../shared/constants/selectors.js';
import { delay } from '../shared/utils/index.js';
import type {
  RuntimeMessage,
  MessageResponse,
  ContentState,
  SelectorHealthReport,
} from '../shared/types/index.js';
import { PanelComponent } from '../ui/components/panel.component.js';
import { ThemeManager } from '../ui/styles/theme-manager.js';
import { buildContentApp } from './composition-root.js';
import { watchSelectorHealth } from './selector-health.js';
import { registerKeyboardShortcuts } from './keyboard-shortcuts.js';
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
  const themeManager = mountPanel(panel, settings.theme, container);

  // Options-page edits reach the running tab (controller handles the rest).
  container
    .resolve('storage')
    .onSettingsChanged((next) => themeManager.apply(next.theme));

  const health: { latest?: SelectorHealthReport } = {};
  watchSelectorHealth(document, detection.client, (report) => {
    health.latest = report;
    controller.setHealth(report);
  });

  window.addEventListener('hashchange', () => controller.notifyLocationChanged());
  window.addEventListener('pagehide', () => {
    void container.resolve('history').flush();
  });

  controller.start(observeRoot ?? document.body);
  registerKeyboardShortcuts({
    isPanelVisible: () => panel.isVisible,
    selectAllVisible: () => controller.selectAllVisible(),
    hasSelection: () => controller.getSelectedIds().length > 0,
    clearSelection: () => controller.clearSelection(),
  });
  registerMessageListener(controller, panel, detection.client, health);

  logger.info('Telegram Media Downloader ready.');
}

function mountPanel(
  panel: PanelComponent,
  theme: Parameters<ThemeManager['apply']>[0],
  container: Awaited<ReturnType<typeof buildContentApp>>['container'],
): ThemeManager {
  panel.host.id = PANEL_ROOT_ID;

  const themeManager = new ThemeManager(panel.host);
  themeManager.apply(theme);

  document.body.appendChild(panel.host);
  panel.connect();
  container.resolve('logger').child('ui').debug('Panel mounted');
  return themeManager;
}

async function restorePanelState(
  panel: PanelComponent,
  container: Awaited<ReturnType<typeof buildContentApp>>['container'],
): Promise<void> {
  const storage = container.resolve('storage');
  const state = await storage.getPanelState();
  panel.configure(state, (next) => void storage.savePanelState(next));
}

function registerMessageListener(
  controller: AppController,
  panel: PanelComponent,
  client: string,
  health: { readonly latest?: SelectorHealthReport },
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
            ...(health.latest ? { health: health.latest } : {}),
          };
          sendResponse({ ok: true, data: state });
          return false;
        }
        default:
          // Other listeners (e.g. the download tracker) handle the rest.
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
