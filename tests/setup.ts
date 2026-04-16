import { beforeEach } from 'vitest';

beforeEach(() => {
  // Ensure a clean DOM between tests.
  document.body.replaceChildren();
  document.head.replaceChildren();
});
