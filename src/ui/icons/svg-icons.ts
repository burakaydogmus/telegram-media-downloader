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
  | 'logo';

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
