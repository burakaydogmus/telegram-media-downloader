import type { TelegramClient } from '../types/index.js';

export interface ClientSelectors {
  readonly appRoot: string;

  readonly loggedIn: string;

  readonly observeRoot: string;

  readonly messageContainer: string;

  readonly message: string;

  readonly photo: string;

  readonly video: string;

  readonly gif: string;

  readonly document: string;

  readonly audio: string;

  readonly contextMenu: string;

  readonly contextMenuItem: string;
}

const WEBK: ClientSelectors = {
  appRoot: '#page-chats, .whole, body.is-shown',
  loggedIn: '#column-center, .chat',
  observeRoot: '#column-center, .chats-container, #main-columns',
  // Message bubbles live in `.bubbles`; the chat list is also `.scrollable`, so
  // `.scrollable` must NOT be used here or the chat list gets scanned instead.
  messageContainer: '.bubbles',
  message: '.bubble, .message',
  photo: '.media-photo, img.media-photo, .album-item img, .attachment > img',
  video: 'video.media-video, .media-video, .media-container video, .video',
  gif: 'video.media-round, .media-gif, .animated-sticker, .media-container video[loop]',
  document: '.document, .document-container, .audio.is-document',
  audio: '.audio:not(.is-document), .voice-message, audio',
  contextMenu: '.btn-menu',
  contextMenuItem: '.btn-menu-item',
};

const WEBA: ClientSelectors = {
  appRoot: '#root, #Main, .Main',
  loggedIn: '#MiddleColumn, .messages-container',
  observeRoot: '#MiddleColumn, .messages-layout, #Main',
  messageContainer: '.MessageList, .messages-container',
  message: '.Message, .message-list-item',
  photo: 'img.full-media, .media-inner img, .Photo img',
  video: 'video, .VideoPlayer video, .Video video',
  gif: 'video.GIF, .Gif video, .media-inner video[loop]',
  document: '.File, .document-action, .Document',
  audio: '.Audio, .Voice, audio',
  contextMenu: '.Menu .bubble, .menu-container, .Menu',
  contextMenuItem: '.MenuItem',
};

const TABLE: Readonly<Record<Exclude<TelegramClient, 'unknown'>, ClientSelectors>> = {
  webk: WEBK,
  weba: WEBA,
};

export function selectorsFor(client: TelegramClient): ClientSelectors {
  if (client === 'unknown') return WEBK;
  return TABLE[client];
}
