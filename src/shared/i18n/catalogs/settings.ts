/**
 * Translation keys owned by the "settings" area. Add keys to `settingsEn` and the same
 * keys to `settingsTr` (the type enforces parity). Merged into the main catalog.
 */
export const settingsEn = {
  options_download_delay: 'Delay between downloads (ms)',
  options_download_delay_desc: 'Minimum pause between two downloads. 0–60000.',
  options_download_jitter: 'Random extra delay (ms)',
  options_download_jitter_desc: 'Adds a random 0…N ms on top of the delay. 0–60000.',
  options_file_name_template: 'File name template',
  options_file_name_template_desc:
    'Relative path for saved files; “/” creates sub-folders. Absolute paths and “..” are not allowed.',
  options_template_tokens: 'Available tokens',
  options_template_preview: 'Preview',
  options_template_invalid:
    'This template is not allowed (absolute path or “..”). The default will be used.',
  options_token_chat: 'chat title',
  options_token_peer: 'chat ID',
  options_token_date: 'message date (YYYY-MM-DD)',
  options_token_time: 'message time (HH-MM-SS)',
  options_token_msgId: 'message ID',
  options_token_index: 'position in an album',
  options_token_type: 'media type',
  options_token_name: 'original file name (without extension)',
  options_token_ext: 'file extension',
  options_prefer_native: 'Prefer Telegram’s own download',
  options_prefer_native_desc:
    'Uses Telegram’s download menu for photos too, so they are saved in full resolution instead of the preview.',
  options_large_file_threshold: 'Large file threshold (MB)',
  options_large_file_threshold_desc:
    'Files above this size are never buffered in memory. 1–4096.',
  options_skip_downloaded: 'Skip already downloaded',
  options_skip_downloaded_desc: 'Do not download items recorded in the download history.',
  options_crawl_auto_download: 'Download while scanning whole chat',
  options_crawl_auto_download_desc:
    'Queue matching media as the chat scan finds it and wait for it before scrolling on.',
} as const;

export const settingsTr: Readonly<Record<keyof typeof settingsEn, string>> = {
  options_download_delay: 'İndirmeler arası bekleme (ms)',
  options_download_delay_desc: 'İki indirme arasındaki en kısa bekleme. 0–60000.',
  options_download_jitter: 'Rastgele ek bekleme (ms)',
  options_download_jitter_desc: 'Beklemeye rastgele 0…N ms ekler. 0–60000.',
  options_file_name_template: 'Dosya adı şablonu',
  options_file_name_template_desc:
    'Kaydedilen dosyalar için göreli yol; “/” alt klasör oluşturur. Mutlak yollar ve “..” kullanılamaz.',
  options_template_tokens: 'Kullanılabilir alanlar',
  options_template_preview: 'Önizleme',
  options_template_invalid:
    'Bu şablona izin verilmiyor (mutlak yol veya “..”). Varsayılan şablon kullanılacak.',
  options_token_chat: 'sohbet adı',
  options_token_peer: 'sohbet kimliği',
  options_token_date: 'mesaj tarihi (YYYY-AA-GG)',
  options_token_time: 'mesaj saati (SS-DD-ss)',
  options_token_msgId: 'mesaj kimliği',
  options_token_index: 'albümdeki sıra',
  options_token_type: 'medya türü',
  options_token_name: 'özgün dosya adı (uzantısız)',
  options_token_ext: 'dosya uzantısı',
  options_prefer_native: 'Telegram’ın kendi indirmesini tercih et',
  options_prefer_native_desc:
    'Fotoğraflar için de Telegram’ın indirme menüsünü kullanır; böylece önizleme yerine tam çözünürlükte kaydedilir.',
  options_large_file_threshold: 'Büyük dosya eşiği (MB)',
  options_large_file_threshold_desc:
    'Bu boyutun üzerindeki dosyalar asla bellekte tutulmaz. 1–4096.',
  options_skip_downloaded: 'Daha önce indirilenleri atla',
  options_skip_downloaded_desc: 'İndirme geçmişinde kayıtlı öğeleri indirme.',
  options_crawl_auto_download: 'Tüm sohbet taranırken indir',
  options_crawl_auto_download_desc:
    'Tarama sırasında bulunan uygun medyayı kuyruğa ekle ve kaydırmaya devam etmeden önce bekle.',
};
