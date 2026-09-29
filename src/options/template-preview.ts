import type { TranslationKey } from '../shared/i18n/index.js';
import { isSafeTemplate, renderTemplatePreview } from './file-name-template.js';

export type Translate = (key: TranslationKey) => string;

/** Syncs the live preview and the validation message with the template input. */
export function updateTemplatePreview(doc: Document, t: Translate): void {
  const field = doc.getElementById('fileNameTemplate') as HTMLInputElement | null;
  const preview = doc.getElementById('templatePreview');
  const invalid = doc.getElementById('templateInvalid');
  if (!field || !preview || !invalid) return;

  const safe = isSafeTemplate(field.value);
  field.setAttribute('aria-invalid', String(!safe));
  invalid.hidden = safe;
  invalid.textContent = safe ? '' : t('options_template_invalid');
  preview.textContent = renderTemplatePreview(field.value);
}
