/**
 * Translation keys owned by the "crawl" area. Add keys to `crawlEn` and the same
 * keys to `crawlTr` (the type enforces parity). Merged into the main catalog.
 */
export const crawlEn = {
  crawl_title: 'Scan whole chat',
  crawl_until_label: 'Stop at date',
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
  crawl_until_label: 'Bu tarihte dur',
  crawl_progress_oldest: '{date} tarihine ulaşıldı',
  crawl_resumed_notice: 'Bu sohbetin önceki taraması sürdürülüyor',
  crawl_error_no_chat: 'Geçmişini taramak için önce bir sohbet açın.',
  crawl_error_no_container: 'Mesaj listesi bulunamadı.',
  crawl_error_container_lost: 'Tarama sırasında mesaj listesi kayboldu.',
  crawl_error_chat_switched: 'Tarama sırasında sohbet değişti; tarama durduruldu.',
  crawl_error_step_failed: 'Tarama başarısız: {reason}',
};
