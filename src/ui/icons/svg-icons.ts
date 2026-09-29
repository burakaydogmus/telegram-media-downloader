const SVG_NS = 'http://www.w3.org/2000/svg';

type IconName =
  | 'download'
  | 'close'
  | 'collapse'
  | 'expand'
  | 'refresh'
  | 'trash'
  | 'retry'
  | 'cancel'
  | 'logo'
  | 'photo'
  | 'video'
  | 'gif'
  | 'document'
  | 'audio'
  | 'locate'
  | 'check'
  | 'warning'
  | 'folder';

const PATHS: Readonly<Record<IconName, readonly string[]>> = {
  download: ['M12 3v12', 'M7 11l5 5 5-5', 'M5 21h14'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  collapse: ['M6 15l6-6 6 6'],
  expand: ['M6 9l6 6 6-6'],
  refresh: ['M21 12a9 9 0 1 1-3-6.7', 'M21 4v5h-5'],
  trash: ['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 13h10l1-13'],
  retry: ['M21 12a9 9 0 1 1-3-6.7', 'M21 4v5h-5'],
  cancel: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M8 8l8 8'],
  logo: ['M12 3v12', 'M7 11l5 5 5-5', 'M5 21h14'],
  photo: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', 'M15.5 8.5h.01'],
  video: ['M3 6h13v12H3z', 'M16 10l5-3v10l-5-3'],
  gif: ['M4 4h16v16H4z', 'M4 9h16', 'M4 15h16', 'M9 4v16', 'M15 4v16'],
  document: ['M6 3h8l4 4v14H6z', 'M14 3v4h4', 'M9 13h6', 'M9 17h6'],
  audio: [
    'M9 18V5l11-2v13',
    'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    'M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  ],
  locate: [
    'M12 3v3',
    'M12 18v3',
    'M3 12h3',
    'M18 12h3',
    'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  ],
  check: ['M5 12l5 5 9-10'],
  warning: ['M12 3l10 18H2z', 'M12 10v5', 'M12 18h.01'],
  folder: ['M3 6h6l2 2h10v11H3z'],
};

export function icon(name: IconName, size = 18): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

export type { IconName };
