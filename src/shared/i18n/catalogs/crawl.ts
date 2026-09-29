/**
 * Translation keys owned by the "crawl" area. Add keys to `crawlEn` and the same
 * keys to `crawlTr` (the type enforces parity). Merged into the main catalog.
 */
export const crawlEn = {
  crawl_title: 'Scan whole chat',
  crawl_start: 'Scan whole chat',
  crawl_pause: 'Pause scan',
  crawl_resume: 'Resume scan',
  crawl_stop: 'Stop scan',
  crawl_until_label: 'Stop at date',
  crawl_status_idle: 'Not scanning',
  crawl_status_running: 'Scanning chat history…',
  crawl_status_paused: 'Scan paused',
  crawl_status_done: 'Scan finished',
  crawl_status_error: 'Scan failed',
  crawl_progress: '{steps} step(s), {found} new item(s)',
  crawl_progress_oldest: 'Reached {date}',
  crawl_resumed_notice: 'Continuing a previous scan of this chat',
  crawl_error_no_chat: 'Open a chat before scanning its history.',
  crawl_error_no_container: 'The message list could not be found.',
  crawl_error_container_lost: 'The message list disappeared during the scan.',
  crawl_error_chat_switched: 'The chat changed during the scan; scan stopped.',
  crawl_error_step_failed: 'Scanning failed: {reason}',
} as const;

export const crawlTr: Readonly<Record<keyof typeof crawlEn, string>> = {
  crawl_title: 'Tüm sohbeti tara',
  crawl_start: 'Tüm sohbeti tara',
  crawl_pause: 'Taramayı duraklat',
  crawl_resume: 'Taramayı sürdür',
  crawl_stop: 'Taramayı durdur',
  crawl_until_label: 'Bu tarihte dur',
  crawl_status_idle: 'Tarama yapılmıyor',
  crawl_status_running: 'Sohbet geçmişi taranıyor…',
  crawl_status_paused: 'Tarama duraklatıldı',
  crawl_status_done: 'Tarama tamamlandı',
  crawl_status_error: 'Tarama başarısız',
  crawl_progress: '{steps} adım, {found} yeni öğe',
  crawl_progress_oldest: '{date} tarihine ulaşıldı',
  crawl_resumed_notice: 'Bu sohbetin önceki taraması sürdürülüyor',
  crawl_error_no_chat: 'Geçmişini taramak için önce bir sohbet açın.',
  crawl_error_no_container: 'Mesaj listesi bulunamadı.',
  crawl_error_container_lost: 'Tarama sırasında mesaj listesi kayboldu.',
  crawl_error_chat_switched: 'Tarama sırasında sohbet değişti; tarama durduruldu.',
  crawl_error_step_failed: 'Tarama başarısız: {reason}',
};
