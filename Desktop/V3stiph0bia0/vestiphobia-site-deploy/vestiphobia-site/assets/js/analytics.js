/**
 * VESTIPHOBIA — first-party analytics.
 *
 * ===========================================================================
 * WHAT THIS COLLECTS, AND WHAT IT REFUSES TO
 * ===========================================================================
 * Sends: which page was viewed, which product and size were looked at, whether
 * a cart was started, whether checkout was begun, and a coarse device class.
 *
 * Never sends: name, phone, address, email, or anything typed into the
 * checkout form. The server enforces that too — it whitelists the fields each
 * event may carry and rejects anything phone- or email-shaped — but nothing
 * here even reads those inputs.
 *
 * Identity is two random values this browser generates for itself: a visitor
 * id in localStorage (so "new vs returning" means something) and a session id
 * in sessionStorage. Neither is derived from anything about the device, so
 * neither is a fingerprint, and clearing site data ends both. No third-party
 * script, no cross-site tracking, no ad network, no cookie.
 *
 * Opting out: Do Not Track and Global Privacy Control are honoured, and
 * `vestiphobia.analytics.optout` in localStorage switches this file off
 * entirely (the privacy policy offers a button that sets it).
 *
 * THIS FILE MUST NEVER BREAK THE SITE. Every entry point is wrapped, every
 * send is fire-and-forget, and nothing in the checkout path waits on it. If
 * the endpoint is down, the shop keeps working and the events are lost —
 * which is the correct trade.
 * ===========================================================================
 */

const CFG = window.VESTI || {};
const ENDPOINT = '/api/events';

// Declared up here because the opt-out helpers below have to be able to clear
// them, and they are defined before the tracker boots.
let queue = [];
let flushTimer = null;
let identity = null;

const VISITOR_KEY = 'vestiphobia.visitor.v1';
const SESSION_KEY = 'vestiphobia.session.v1';
const OPTOUT_KEY = 'vestiphobia.analytics.optout';
const SESSION_IDLE_MS = 30 * 60 * 1000;

/* ------------------------------------------------------------- opt out */

function optedOut() {
  try {
    if (localStorage.getItem(OPTOUT_KEY) === '1') return true;
  } catch {
    /* storage blocked — fall through to the browser signals */
  }
  return (
    navigator.doNotTrack === '1' ||
    window.doNotTrack === '1' ||
    navigator.msDoNotTrack === '1' ||
    navigator.globalPrivacyControl === true
  );
}

/** Used by the privacy page button. Exposed on window so no import is needed. */
window.vestiAnalyticsOptOut = () => {
  // Stop collecting FIRST, and throw away anything already queued. An event
  // recorded a moment before someone opted out must not be sent a moment
  // after: that would make the opt-out a formality.
  identity = null;
  queue.length = 0;
  clearTimeout(flushTimer);
  flushTimer = null;
  try {
    localStorage.setItem(OPTOUT_KEY, '1');
    localStorage.removeItem(VISITOR_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    return true;
  } catch {
    return false;
  }
};
window.vestiAnalyticsOptIn = () => {
  try {
    localStorage.removeItem(OPTOUT_KEY);
    return true;
  } catch {
    return false;
  }
};
window.vestiAnalyticsStatus = () => (optedOut() ? 'off' : 'on');

/**
 * The privacy page control.
 *
 * Wired up OUTSIDE the opt-out check, so someone who has opted out can still
 * see their choice reflected and switch it back on. A control that disappears
 * once used is not a control.
 */
(function optOutControl() {
  const mount = document.querySelector('[data-analytics-optout]');
  if (!mount) return;
  const button = mount.querySelector('[data-optout-toggle]');
  const status = mount.querySelector('[data-optout-status]');
  if (!button) return;

  const browserSignal =
    navigator.doNotTrack === '1' ||
    window.doNotTrack === '1' ||
    navigator.msDoNotTrack === '1' ||
    navigator.globalPrivacyControl === true;

  const paint = () => {
    const off = optedOut();
    button.textContent = off ? 'Turn analytics back on' : 'Turn analytics off';
    if (!status) return;
    status.textContent = browserSignal
      ? 'Off — your browser sends a Do Not Track signal, which this site honours.'
      : off
        ? 'Off in this browser.'
        : 'On in this browser.';
    // A browser-level signal cannot be overridden from a page, and offering a
    // button that would not work would be a lie.
    button.disabled = browserSignal;
  };

  button.addEventListener('click', () => {
    if (optedOut()) window.vestiAnalyticsOptIn();
    else window.vestiAnalyticsOptOut();
    paint();
  });

  paint();
})();

/* ------------------------------------------------------------ identity */

const uuid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

function readJson(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode, or storage full — analytics simply stops persisting */
  }
}

/** A visitor id, and whether this browser has been here before. */
function visitor() {
  const stored = readJson(localStorage, VISITOR_KEY);
  if (stored?.id) return { id: stored.id, isNew: false };
  const id = uuid();
  writeJson(localStorage, VISITOR_KEY, { id, first: new Date().toISOString() });
  return { id, isNew: true };
}

/**
 * A session id that rolls over after 30 minutes of inactivity — the common
 * convention, so the numbers mean what an analyst expects them to mean.
 * Attribution is captured on the first hit and then frozen for the session, so
 * an internal navigation cannot overwrite the source that brought the visit.
 */
function session(isNewVisitor) {
  const nowMs = Date.now();
  const stored = readJson(sessionStorage, SESSION_KEY);

  if (stored?.id && nowMs - Number(stored.seen || 0) < SESSION_IDLE_MS) {
    stored.seen = nowMs;
    writeJson(sessionStorage, SESSION_KEY, stored);
    return stored;
  }

  const params = new URLSearchParams(window.location.search);
  const utm = {
    source: params.get('utm_source') || '',
    medium: params.get('utm_medium') || '',
    campaign: params.get('utm_campaign') || '',
    content: params.get('utm_content') || '',
    term: params.get('utm_term') || '',
  };

  const fresh = {
    id: uuid(),
    started: nowMs,
    seen: nowMs,
    isNewVisitor,
    utm,
    // Captured here, not inferred by the server. Batches are sent with
    // sendBeacon and can arrive out of order — the page that was left first
    // often reports last — so the server must be told which page began the
    // session rather than assuming it was the first batch it received.
    landingPath: window.location.pathname,
    // An internal referrer is not an acquisition source; the server treats it
    // as such, and sending it would only muddy the report.
    referrer: document.referrer || '',
  };
  writeJson(sessionStorage, SESSION_KEY, fresh);
  return fresh;
}

/* --------------------------------------------------------------- queue */

function payload() {
  return {
    visitorId: identity.visitor.id,
    sessionId: identity.session.id,
    isNewVisitor: Boolean(identity.session.isNewVisitor),
    referrer: identity.session.referrer,
    utm: identity.session.utm,
    landingPath: identity.session.landingPath,
    screenWidth: window.screen?.width || window.innerWidth || 0,
    events: queue.splice(0, queue.length),
  };
}

/**
 * Send whatever is queued.
 *
 * `sendBeacon` first: it survives the page being closed, which is exactly when
 * the last and most interesting events (exit page, engagement) are sent. fetch
 * with keepalive is the fallback.
 */
function flush(final = false) {
  if (!queue.length) return;
  clearTimeout(flushTimer);
  flushTimer = null;

  const body = JSON.stringify(payload());
  try {
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      if (ok) return;
    }
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: final,
    }).catch(() => {
      /* the shop does not care whether analytics arrived */
    });
  } catch {
    /* never let a send failure surface */
  }
}

function schedule() {
  if (flushTimer) return;
  // Batched, so a burst of interactions is one request rather than ten.
  flushTimer = setTimeout(() => flush(false), 1500);
}

/* --------------------------------------------------------------- track */

/** Events worth a request of their own. See `track`. */
const IMMEDIATE = new Set([
  'product_view',
  'size_select',
  'add_to_cart',
  'remove_from_cart',
  'view_cart',
  'begin_checkout',
  'order_created',
  'whatsapp_click',
  'checkout_error',
]);

let engagementStart = Date.now();
let engagedMs = 0;
const seen = new Set();

/**
 * Queue one event.
 *
 * `once` guards against a component that re-renders sending the same event
 * repeatedly — a page_view fired twice makes every rate on the dashboard wrong.
 */
export function track(name, props = {}, { once = false, engaged = null } = {}) {
  try {
    if (!identity) return;
    const key = `${name}:${JSON.stringify(props)}`;
    if (once) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    queue.push({
      id: uuid(),
      name,
      path: window.location.pathname,
      props,
      engagedMs: engaged,
      at: new Date().toISOString(),
    });

    // Funnel milestones are sent immediately rather than batched.
    //
    // Batching is right for page views and engagement — they are frequent and
    // individually unimportant. A milestone is the opposite: rare, and the
    // whole point of the measurement. Waiting for the batch timer means losing
    // it whenever the visitor navigates straight on, and an unload beacon is
    // the least reliable delivery there is.
    if (IMMEDIATE.has(name) || queue.length >= 10) flush(false);
    else schedule();
  } catch {
    /* analytics must never throw into a caller */
  }
}

/* ---------------------------------------------------------------- boot */

if (!optedOut()) {
  try {
    const v = visitor();
    identity = { visitor: v, session: session(v.isNew) };

    /* --- page view, exactly once per page load --- */
    track('page_view', { title: document.title.slice(0, 120) }, { once: true });

    /* --- product and list views, derived from the page itself --- */
    const product = document.querySelector('[data-product]');
    if (product?.dataset.slug) {
      track(
        'product_view',
        {
          slug: product.dataset.slug,
          price: Number(product.dataset.price) || undefined,
          currency: CFG.currency || 'USD',
        },
        { once: true }
      );
    }

    const grid = document.querySelector('[data-product-grid]');
    if (grid) {
      track(
        'product_list_view',
        { list: window.location.pathname, count: grid.querySelectorAll('[data-product-card]').length },
        { once: true }
      );
    }

    if (window.location.pathname.startsWith('/cart')) {
      track('view_cart', {}, { once: true });
    }

    /* --- foreground time, measured honestly --- */
    // This is time the tab was VISIBLE, not "time on page": a tab left open in
    // the background for an hour contributes nothing. It is still an estimate,
    // and the dashboard labels it as engaged time rather than as a duration.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        engagedMs += Date.now() - engagementStart;
        track('page_engagement', { title: document.title.slice(0, 120) }, { engaged: engagedMs });
        engagedMs = 0;
        flush(true);
      } else {
        engagementStart = Date.now();
      }
    });

    window.addEventListener('pagehide', () => {
      engagedMs += Date.now() - engagementStart;
      if (engagedMs > 500) {
        track('page_engagement', { title: document.title.slice(0, 120) }, { engaged: engagedMs });
      }
      flush(true);
    });

    /* --- events dispatched by the rest of the site --- */
    // The cart, product and checkout modules dispatch `vesti:track` and know
    // nothing about this file. If analytics is not loaded, those dispatches are
    // simply unheard — no module has to check whether tracking exists.
    window.addEventListener('vesti:track', (event) => {
      const { name, props, once } = event.detail || {};
      if (name) track(name, props || {}, { once: Boolean(once) });
    });

    /* --- outbound and WhatsApp clicks --- */
    document.addEventListener(
      'click',
      (event) => {
        const link = event.target?.closest?.('a[href]');
        if (!link) return;
        const href = link.getAttribute('href') || '';
        if (href.startsWith('https://wa.me/')) {
          // The order number, and nothing else — never the destination number.
          const orderNumber = document.querySelector('[data-order-id]')?.textContent?.trim() || '';
          track('whatsapp_click', {
            order_number: /^[A-Z]{2,4}-\d{4}-\d{3,6}$/.test(orderNumber) ? orderNumber : '',
            surface: window.location.pathname,
          });
          flush(true);
          return;
        }
        if (/^https?:\/\//i.test(href) && !href.includes(window.location.host)) {
          let host = '';
          try {
            host = new URL(href).host;
          } catch {
            host = '';
          }
          if (host) track('outbound_click', { destination: host });
        }
      },
      { capture: true }
    );
  } catch (err) {
    // A broken tracker is a broken tracker, not a broken shop.
    console.warn('[vestiphobia] analytics disabled after an error:', err);
    identity = null;
  }
}
