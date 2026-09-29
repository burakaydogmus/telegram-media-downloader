import { Container } from '../shared/di/index.js';
import { Logger, type ILogger } from '../shared/logger/index.js';
import { I18n, type II18n } from '../shared/i18n/index.js';
import type { Settings, FilterState, DetectionResult } from '../shared/types/index.js';

import { MediaRegistry } from './media-registry.js';
import { MediaScanner } from './media-scanner.js';
import { MutationEngine } from './mutation-engine.js';
import { TelegramDetector } from './telegram-detector.js';
import { ChatCrawler } from './chat-crawler.js';
import { currentPeerId } from './peer.js';
import { findMediaElement } from './native-download.js';

import { SelectionService } from '../features/selection/index.js';
import { SearchService } from '../features/search/index.js';
import { FilterService } from '../features/filter/index.js';
import {
  DownloadQueue,
  DownloadTracker,
  DirectoryWriter,
  createDownloadExecutor,
} from '../features/download/index.js';
import { ReportService } from '../features/reporting/index.js';
import {
  createPersistence,
  type DownloadHistory,
  type StorageService,
} from '../features/local-storage/index.js';
import type { CrawlCheckpointStore } from '../shared/types/index.js';

import { AppController } from './app-controller.js';

export type ContentServices = {
  logger: ILogger;
  i18n: II18n;
  storage: StorageService;
  history: DownloadHistory;
  checkpoints: CrawlCheckpointStore;
  registry: MediaRegistry;
  detector: TelegramDetector;
  scanner: MediaScanner;
  mutationEngine: MutationEngine;
  selection: SelectionService;
  search: SearchService;
  filter: FilterService;
  tracker: DownloadTracker;
  directory: DirectoryWriter;
  queue: DownloadQueue;
  report: ReportService;
  controller: AppController;
};

export interface BuildResult {
  readonly container: Container<ContentServices>;
  readonly controller: AppController;
  readonly detection: DetectionResult;
}

export async function buildContentApp(): Promise<BuildResult> {
  const bootstrapLogger = new Logger('info', 'app');
  const { storage, history, checkpoints } = createPersistence({
    logger: bootstrapLogger,
  });

  const settings: Settings = await storage.getSettings();
  const filters: FilterState = await storage.getFilters();
  // The history must be warm before filters/skip logic use its sync `has()`.
  await history.load();

  const container = new Container<ContentServices>();

  container
    .registerSingleton('logger', () => new Logger(settings.logLevel, 'app'))
    .registerSingleton('i18n', () => new I18n(settings.language))
    .registerSingleton('storage', () => storage)
    .registerSingleton('history', () => history)
    .registerSingleton('checkpoints', () => checkpoints)
    .registerSingleton('registry', (c) => new MediaRegistry(c.resolve('logger')))
    .registerSingleton(
      'detector',
      (c) => new TelegramDetector(document, c.resolve('logger')),
    )
    .registerSingleton('selection', () => new SelectionService())
    .registerSingleton('search', () => new SearchService())
    .registerSingleton('filter', () => new FilterService())
    .registerSingleton('report', () => new ReportService())
    .registerSingleton('tracker', () => new DownloadTracker())
    .registerSingleton(
      'directory',
      (c) => new DirectoryWriter({ logger: c.resolve('logger').child('folder') }),
    );

  const detector = container.resolve('detector');
  const detection = detector.detect();
  const { client } = detection;

  container.registerSingleton(
    'scanner',
    (c) => new MediaScanner(client, document, c.resolve('logger')),
  );

  // Settings are read live through the controller so option changes apply to
  // the running queue (delay/jitter, routing, templates).
  container.registerSingleton(
    'queue',
    (c) =>
      new DownloadQueue(
        createDownloadExecutor({
          doc: document,
          client,
          logger: c.resolve('logger').child('download'),
          tracker: c.resolve('tracker'),
          directoryWriter: c.resolve('directory'),
          getSettings: () => c.resolve('controller').getSettings(),
        }),
        {
          maxConcurrent: settings.maxConcurrentDownloads,
          maxRetries: settings.maxRetries,
        },
        c.resolve('logger'),
      ),
  );

  // The handler resolves the controller lazily (at flush time) to break the
  // construction-time cycle between the engine and the controller.
  container.registerSingleton(
    'mutationEngine',
    (c) =>
      new MutationEngine(
        (roots) => c.resolve('controller').handleMutations(roots),
        {},
        c.resolve('logger'),
      ),
  );

  container.registerSingleton(
    'controller',
    (c) =>
      new AppController({
        logger: c.resolve('logger'),
        i18n: c.resolve('i18n'),
        registry: c.resolve('registry'),
        scanner: c.resolve('scanner'),
        mutationEngine: c.resolve('mutationEngine'),
        selection: c.resolve('selection'),
        search: c.resolve('search'),
        filter: c.resolve('filter'),
        queue: c.resolve('queue'),
        report: c.resolve('report'),
        storage: c.resolve('storage'),
        history: c.resolve('history'),
        directory: c.resolve('directory'),
        getPeerId: () => currentPeerId(document, client),
        locate: (item) => findMediaElement(document, client, item),
        createCrawler: (hooks) =>
          new ChatCrawler({
            doc: document,
            client,
            logger: c.resolve('logger').child('crawler'),
            checkpoints: c.resolve('checkpoints'),
            getPeerId: hooks.getPeerId,
            onStep: hooks.onStep,
          }),
        settings,
        filters,
      }),
  );

  const controller = container.resolve('controller');
  // Restores a previously chosen save folder without prompting.
  void container.resolve('directory').restore();
  return { container, controller, detection };
}
