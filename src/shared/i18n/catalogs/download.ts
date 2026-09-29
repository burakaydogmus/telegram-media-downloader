/**
 * Translation keys owned by the "download" area. Add keys to `downloadEn` and the same
 * keys to `downloadTr` (the type enforces parity). Merged into the main catalog.
 */
export const downloadEn = {
  download_pause: 'Pause',
  download_resume: 'Resume',
  download_paused: 'Downloads paused',
  download_paused_flood:
    'Telegram is rate-limiting downloads. The queue was paused; resume in a few minutes.',
  download_error_not_on_screen:
    'Media is not on screen. Scroll to it in the chat, then retry this item.',
  download_error_no_menu_item:
    'Telegram offers no download for this item (it may be save-protected).',
  download_error_not_started: 'Telegram did not start a download.',
  download_error_interrupted: 'The download was interrupted.',
  download_folder_pick: 'Choose download folder',
  download_folder_clear: 'Forget download folder',
  download_folder_unsupported: 'Saving to a folder is not supported by this browser.',
  download_folder_permission: 'Allow access to the download folder to continue.',
} as const;

export const downloadTr: Readonly<Record<keyof typeof downloadEn, string>> = {
  download_pause: 'Duraklat',
  download_resume: 'Devam et',
  download_paused: 'İndirmeler duraklatıldı',
  download_paused_flood:
    'Telegram indirmeleri sınırlıyor. Kuyruk duraklatıldı; birkaç dakika sonra devam edin.',
  download_error_not_on_screen:
    'Medya ekranda değil. Sohbette ona kaydırın, ardından bu öğeyi yeniden deneyin.',
  download_error_no_menu_item:
    'Telegram bu öğe için indirme sunmuyor (kaydetme korumalı olabilir).',
  download_error_not_started: 'Telegram bir indirme başlatmadı.',
  download_error_interrupted: 'İndirme yarıda kesildi.',
  download_folder_pick: 'İndirme klasörü seç',
  download_folder_clear: 'İndirme klasörünü unut',
  download_folder_unsupported: 'Bu tarayıcı bir klasöre kaydetmeyi desteklemiyor.',
  download_folder_permission: 'Devam etmek için indirme klasörüne erişim izni verin.',
};
