/**
 * Translation keys owned by the "health" area. Add keys to `healthEn` and the same
 * keys to `healthTr` (the type enforces parity). Merged into the main catalog.
 */
export const healthEn = {
  health_title: 'Page structure not recognised',
  health_failed_intro: 'These required page elements could not be found:',
  health_hint:
    'Telegram’s layout may have changed. Update the selectors in src/shared/constants/selectors.ts or report an issue.',
  health_check_appRoot: 'App root',
  health_check_loggedIn: 'Logged-in view',
  health_check_observeRoot: 'Chat area',
  health_check_messageContainer: 'Message list',
  health_check_message: 'Messages',

  popup_not_telegram:
    'Open Telegram Web (web.telegram.org) in this tab to use the downloader.',
  popup_not_injected:
    'The downloader is not running on this tab. Reload it — tabs opened before the extension was installed or updated need a reload.',
  popup_no_response:
    'Telegram Web is open but the downloader did not respond. Make sure you are logged in, then reload the tab.',
  popup_reload_tab: 'Reload tab',
} as const;

export const healthTr: Readonly<Record<keyof typeof healthEn, string>> = {
  health_title: 'Sayfa yapısı tanınmadı',
  health_failed_intro: 'Gerekli şu sayfa öğeleri bulunamadı:',
  health_hint:
    'Telegram’ın arayüzü değişmiş olabilir. src/shared/constants/selectors.ts içindeki seçicileri güncelleyin veya bir sorun bildirin.',
  health_check_appRoot: 'Uygulama kökü',
  health_check_loggedIn: 'Oturum açılmış görünüm',
  health_check_observeRoot: 'Sohbet alanı',
  health_check_messageContainer: 'Mesaj listesi',
  health_check_message: 'Mesajlar',

  popup_not_telegram:
    'İndiriciyi kullanmak için bu sekmede Telegram Web’i (web.telegram.org) açın.',
  popup_not_injected:
    'İndirici bu sekmede çalışmıyor. Sekmeyi yenileyin — eklenti kurulmadan veya güncellenmeden önce açılan sekmelerin yenilenmesi gerekir.',
  popup_no_response:
    'Telegram Web açık ancak indirici yanıt vermedi. Giriş yaptığınızdan emin olun ve sekmeyi yenileyin.',
  popup_reload_tab: 'Sekmeyi yenile',
};
