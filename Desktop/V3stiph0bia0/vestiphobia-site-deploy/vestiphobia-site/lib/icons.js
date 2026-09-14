/**
 * VESTIPHOBIA — line icon set.
 *
 * Thin stroke, no fill, no decoration: the interface stays quiet and lets
 * typography and photography carry the identity. Every icon shares the same
 * stroke weight and viewBox so they read as one system rather than a mix of
 * borrowed glyphs.
 */

const svg = (paths, viewBox = '0 0 24 24') =>
  `<svg class="icon" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

export const iconClose = () => svg('<path d="M5 5l14 14M19 5L5 19"/>');

export const iconBag = () =>
  svg('<path d="M7 8h10l1 12H6L7 8z"/><path d="M9 8V6.5a3 3 0 016 0V8"/>');

export const iconArrow = () => svg('<path d="M4 12h16M14 6l6 6-6 6"/>');
