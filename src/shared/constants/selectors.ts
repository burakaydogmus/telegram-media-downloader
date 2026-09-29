import type { TelegramClient } from '../types/index.js';

export interface ClientSelectors {
  readonly appRoot: string;

  readonly loggedIn: string;

  /** Auth screens; while one is shown the user is not logged in even if `loggedIn` matches. */
  readonly loggedOut: string;

  /** DOM signature identifying the client when the URL path is ambiguous. */
  readonly signature: string;

  readonly observeRoot: string;

  readonly messageContainer: string;

  /** Container of the chat currently on screen (preferred over `messageContainer`). */
  readonly activeMessageContainer: string;

  readonly message: string;

  /** Exactly one element per message; media is classified once per element. */
  readonly messageBubble: string;

  /** Messages that never carry downloadable media (service, stickers, big emoji). */
  readonly skipMessage: string;

  /** Individual items of an album / grouped message. */
  readonly albumItem: string;

  /** Sub-trees inside a message that are never scanned (replies, avatars, stickers…). */
  readonly ignore: string;

  /** Page regions that are never part of the message list. */
  readonly exclude: string;

  readonly photo: string;

  readonly video: string;

  /** Round video messages (classified as `video`). */
  readonly roundVideo: string;

  readonly gif: string;

  readonly document: string;

  readonly audio: string;

  readonly fileName: string;

  readonly fileSize: string;

  readonly time: string;

  /** Day group of messages; its attributes/header give a date fallback. */
  readonly dateGroup: string;

  readonly dateGroupHeader: string;

  /** Priority-ordered, comma-separated (no nested commas) chat-title candidates. */
  readonly chatTitle: string;

  /** Priority-ordered, comma-separated elements carrying the open chat's `data-peer-id`. */
  readonly chatPeer: string;

  readonly contextMenu: string;

  readonly contextMenuItem: string;
}

const PANEL_HOST = '#tg-media-downloader-root';

const WEBK: ClientSelectors = {
  appRoot: '#page-chats, .whole, body.is-shown',
  loggedIn: '#column-center, .chat, .chatlist',
  loggedOut:
    '#auth-pages .page-sign.active, #auth-pages .page-signQR.active, #auth-pages .page-authCode.active, #auth-pages .page-password.active, #auth-pages .page-signUp.active',
  signature: '#page-chats, #column-center, #main-columns, #auth-pages, .whole',
  observeRoot: '#column-center, .chats-container, #main-columns',
  // Message bubbles live in `.bubbles`; the chat list is also `.scrollable`, so
  // `.scrollable` must NOT be used here or the chat list gets scanned instead.
  messageContainer: '.bubbles',
  activeMessageContainer: '.chat.active .bubbles',
  message: '.bubble, .message',
  messageBubble: '.bubble',
  skipMessage: '.service, .is-date, .sticker, .emoji-big',
  albumItem: '.album-item, .document-container[data-mid]',
  ignore:
    '.reply, .reply-media, .avatar-element, .bubble-beside-button, .reactions, .webpage, .web, .sticker, .media-sticker-wrapper, .custom-emoji, .custom-emoji-renderer, .emoji, .stories-ring, .replies-footer',
  exclude: `${PANEL_HOST}, .media-viewer-whole, #column-left, #column-right, .emoji-dropdown, .chatlist`,
  photo: '.media-photo, img.media-photo, .album-item img, .attachment > img',
  video:
    'video.media-video, .media-video, .media-container video, .video, .video-time, .video-play',
  roundVideo: '.media-round, .round, video.media-round',
  gif: '.media-gif, .gif, video.media-gif, .media-container video[loop]',
  document: '.document, .document-container, .audio.is-document',
  audio: '.audio:not(.is-document), .voice-message, audio-element, audio',
  fileName: '.document-name, .audio-title, .file-name',
  fileSize: '.document-size, .file-size, .audio-subtitle',
  time: '.time, .time-inner',
  dateGroup: '.bubbles-date-group',
  dateGroupHeader: '.is-date, .service-msg',
  chatTitle:
    '.chat.active .chat-info .peer-title, .chat-info .peer-title, .top .peer-title',
  chatPeer:
    '.chat.active .chat-info [data-peer-id], .chat-info [data-peer-id], .chat.active [data-peer-id]',
  contextMenu: '.btn-menu',
  contextMenuItem: '.btn-menu-item',
};

const WEBA: ClientSelectors = {
  appRoot: '#root, #Main, .Main',
  loggedIn: '#MiddleColumn, .messages-container, #LeftColumn',
  loggedOut:
    '#auth-phone-number-form, #auth-qr-form, #auth-code-form, #auth-password-form, #auth-registration-form',
  signature:
    '#Main, #MiddleColumn, .Main, #LeftColumn, #auth-qr-form, #auth-phone-number-form',
  observeRoot: '#MiddleColumn, .messages-layout, #Main',
  messageContainer: '.MessageList, .messages-container',
  activeMessageContainer: '.MessageList',
  message: '.Message, .message-list-item',
  messageBubble: '.Message',
  skipMessage: '.ActionMessage, .is-sticker, .emoji-only',
  albumItem: '.album-item-select-wrapper, .Album > .media-inner',
  ignore:
    '.EmbeddedMessage, .Avatar, .Reactions, .message-reactions, .WebPage, .sticker, .sticker-media, .StickerView, .AnimatedSticker, .AnimatedEmoji, .custom-emoji, .emoji, .InlineButtons, .CommentButton',
  exclude: `${PANEL_HOST}, #MediaViewer, .MediaViewer, #LeftColumn, #RightColumn, .SymbolMenu, .StickerPicker`,
  photo: 'img.full-media, .media-inner img, .Photo img',
  video: 'video, .VideoPlayer video, .Video video, .message-media-duration',
  roundVideo: '.RoundVideo',
  gif: 'video.GIF, .Gif video, .media-inner video[loop], .media-inner.is-gif',
  document: '.File, .document-action, .Document',
  audio: '.Audio, .Voice, audio',
  fileName: '.File-name, .file-title, .file-name, .Audio .title',
  fileSize: '.File-size, .file-subtitle, .file-size',
  time: '.message-time',
  dateGroup: '.message-date-group',
  dateGroupHeader: '.sticky-date',
  chatTitle:
    '.MiddleHeader .ChatInfo .fullName, .ChatInfo .fullName, .ChatInfo .title h3, .ChatInfo .title',
  chatPeer: '.MiddleHeader .ChatInfo [data-peer-id], .ChatInfo [data-peer-id]',
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
