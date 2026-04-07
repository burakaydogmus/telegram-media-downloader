import { Container } from '../shared/di/index.js';
import { Logger, type ILogger } from '../shared/logger/index.js';
import { I18n, type II18n } from '../shared/i18n/index.js';
import type { Settings, FilterState, DetectionResult } from '../shared/types/index.js';

import { MediaRegistry } from './media-registry.js';
import { MediaScanner } from './media-scanner.js';
import { MutationEngine } from './mutation-engine.js';
import { TelegramDetector } from './telegram-detector.js';

import { SelectionService } from '../features/selection/index.js';
import { SearchService } from '../features/search/index.js';
import { FilterService } from '../features/filter/index.js';
import {
  DownloadQueue,
  BlobDownloadExecutor,
  CompositeDownloadExecutor,
} from '../features/download/index.js';
import { NativeDownloadTrigger } from './native-download.js';
import { ReportService } from '../features/reporting/index.js';
import {
  StorageService,
  createDefaultStorageDriver,
} from '../features/local-storage/index.js';

import { AppController } from './app-controller.js';

export type ContentServices = {
  logger: ILogger;
  i18n: II18n;
  storage: StorageService;
  registry: MediaRegistry;
  detector: TelegramDetector;
  scanner: MediaScanner;
  mutationEngine: MutationEngine;
  selection: SelectionService;
  search: SearchService;
  filter: FilterService;
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
  const driver = createDefaultStorageDriver();
  const bootstrapLogger = new Logger('info', 'app');
  const bootstrapStorage = new StorageService(driver, bootstrapLogger);

  const settings: Settings = await bootstrapStorage.getSettings();
  const filters: FilterState = await bootstrapStorage.getFilters();

  const container = new Container<ContentServices>();

  container
    .registerSingleton('logger', () => new Logger(settings.logLevel, 'app'))
    .registerSingleton('i18n', () => new I18n(settings.language))
    .registerSingleton('storage', (c) => new StorageService(driver, c.resolve('logger')))
    .registerSingleton('registry', (c) => new MediaRegistry(c.resolve('logger')))
    .registerSingleton(
      'detector',
      (c) => new TelegramDetector(document, c.resolve('logger')),
    )
    .registerSingleton('selection', () => new SelectionService())
    .registerSingleton('search', () => new SearchService())
    .registerSingleton('filter', () => new FilterService())
    .registerSingleton('report', () => new ReportService());

  const detector = container.resolve('detector');
  const detection = detector.detect();

  container.registerSingleton(
    'scanner',
    (c) => new MediaScanner(detection.client, document, c.resolve('logger')),
  );

  // Direct byte-fetch (photos/docs) with a fallback to Telegram's own download
  // (streamed videos, viewable-but-unfetchable media).
  container.registerSingleton(
    'queue',
    (c) =>
      new DownloadQueue(
        new CompositeDownloadExecutor(
          new BlobDownloadExecutor(document),
          new NativeDownloadTrigger(detection.client, document, c.resolve('logger')),
        ),
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
        settings,
        filters,
      }),
  );

  const controller = container.resolve('controller');
  return { container, controller, detection };
}
