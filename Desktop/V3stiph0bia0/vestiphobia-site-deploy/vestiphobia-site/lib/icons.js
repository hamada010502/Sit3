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

// A filled triangle is the universal play glyph — recognisable at the tiny
// size a transport control renders at in a way an outlined one is not — so
// it is the one deliberate exception to "no fill" in this file.
export const iconPlay = () =>
  `<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z"/></svg>`;

export const iconPause = () => svg('<path d="M8 5v14M16 5v14"/>');

// A simple soundwave — reads clearly as "audio" at the small size a
// collapsed player tab renders at, unlike a literal radio-set glyph would.
export const iconRadio = () => svg('<path d="M4 10v4M9 6v12M14 3v18M19 9v6"/>');
