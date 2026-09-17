/** Product page: gallery, lightbox, size selection, quantity, add to cart. */

/**
 * Fire-and-forget analytics. The tracker listens for this event; if it is not
 * loaded (or the visitor opted out) nothing hears it and nothing breaks. This
 * module therefore never has to check whether analytics exists.
 */
const emit = (name, props = {}, once = false) => {
  try {
    window.dispatchEvent(new CustomEvent('vesti:track', { detail: { name, props, once } }));
  } catch {
    /* never let telemetry interrupt the page */
  }
};

import { add, openCart } from './store.js';

const root = document.querySelector('[data-product]');
if (root) {
  const slug = root.dataset.product;

  /* ------------------------------------------------------------ gallery */

  const gal = root.querySelector('[data-gallery]');
  const track = gal?.querySelector('[data-gal-track]');
  const thumbs = [...(gal?.querySelectorAll('[data-gal-thumb]') || [])];
  const dots = [...(gal?.querySelectorAll('[data-gal-dot]') || [])];
  const counter = gal?.querySelector('[data-gal-counter]');
  const total = Number(gal?.dataset.galTotal || 0);
  const slides = [...(track?.querySelectorAll('[data-gal-slide]') || [])];

  const markActive = (i) => {
    thumbs.forEach((t, n) => {
      t.classList.toggle('is-active', n === i);
      if (n === i) t.setAttribute('aria-current', 'true');
      else t.removeAttribute('aria-current');
    });
    dots.forEach((d, n) => {
      d.classList.toggle('is-active', n === i);
      if (n === i) d.setAttribute('aria-current', 'true');
      else d.removeAttribute('aria-current');
    });
    if (counter) counter.textContent = `${i + 1} / ${total}`;
  };

  thumbs.forEach((t, i) => {
    t.addEventListener('click', () => {
      slides[i]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
      markActive(i);
      // `once` per index: dragging back and forth over the same thumbnail is
      // one interaction with that image, not twenty.
      emit('gallery_interaction', { slug, action: 'thumb', index: i + 1 }, true);
    });
  });

  dots.forEach((d, i) => {
    d.addEventListener('click', () => {
      slides[i]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
      markActive(i);
      emit('gallery_interaction', { slug, action: 'dot', index: i + 1 }, true);
    });
  });

  // Track which slide is in view on the mobile swipe carousel.
  if (track && slides.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
            markActive(slides.indexOf(entry.target));
          }
        });
      },
      { root: track, threshold: [0.6] }
    );
    slides.forEach((s) => io.observe(s));
  }

  /* ----------------------------------------------------------- lightbox */

  const lb = document.querySelector('[data-lightbox]');
  const lbImg = lb?.querySelector('[data-lb-img]');
  const lbCounter = lb?.querySelector('[data-lb-counter]');
  const sources = slides.map((s) => {
    const im = s.querySelector('img');
    return { src: im?.src, alt: im?.alt || '' };
  });
  let lbIndex = 0;
  let lbReturnFocus = null;

  const showLb = (i) => {
    lbIndex = (i + sources.length) % sources.length;
    if (lbImg) {
      lbImg.src = sources[lbIndex].src;
      lbImg.alt = sources[lbIndex].alt;
    }
    if (lbCounter) lbCounter.textContent = `${lbIndex + 1} / ${sources.length}`;
  };

  const openLb = (i, trigger) => {
    if (!lb) return;
    lbReturnFocus = trigger || document.activeElement;
    showLb(i);
    lb.hidden = false;
    document.body.classList.add('is-locked');
    lb.querySelector('[data-lb-close]')?.focus();
  };

  const closeLb = () => {
    if (!lb || lb.hidden) return;
    lb.hidden = true;
    document.body.classList.remove('is-locked');
    lbReturnFocus?.focus();
  };

  root.querySelectorAll('[data-gal-open]').forEach((btn) => {
    btn.addEventListener('click', () => emit('gallery_interaction', { slug, action: 'zoom' }, true));
    btn.addEventListener('click', () => openLb(Number(btn.dataset.galOpen), btn));
  });
  lb?.querySelector('[data-lb-close]')?.addEventListener('click', closeLb);
  lb?.querySelector('[data-lb-prev]')?.addEventListener('click', () => showLb(lbIndex - 1));
  lb?.querySelector('[data-lb-next]')?.addEventListener('click', () => showLb(lbIndex + 1));
  lb?.addEventListener('click', (e) => {
    if (e.target === lb) closeLb();
  });

  document.addEventListener('keydown', (e) => {
    if (!lb || lb.hidden) return;
    if (e.key === 'Escape') closeLb();
    else if (e.key === 'ArrowLeft') showLb(lbIndex - 1);
    else if (e.key === 'ArrowRight') showLb(lbIndex + 1);
    else if (e.key === 'Tab') {
      // The lightbox covers the whole page, so Tab must not walk out of it
      // into the product page underneath — a keyboard user would be moving
      // focus through content they cannot see or reach back from.
      const focusables = [...lb.querySelectorAll('button')].filter((b) => !b.disabled);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !lb.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !lb.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  /* ------------------------------------------------- size and quantity */

  const form = root.querySelector('[data-add-form]');
  const sizeGroup = root.querySelector('[data-size-group]');
  const sizeBtns = [...root.querySelectorAll('[data-size]')];
  const hint = root.querySelector('[data-size-hint]');
  const addBtn = root.querySelector('[data-add-btn]');
  const status = root.querySelector('[data-add-status]');
  const qtyInput = root.querySelector('[data-qty-input]');
  const decBtn = root.querySelector('[data-qty-dec]');
  const incBtn = root.querySelector('[data-qty-inc]');

  // `selectable` is recomputed after the live-availability sync below, because
  // a size that sold out since the last build must drop out of the keyboard
  // rotation too, not just look disabled.
  let selectable = sizeBtns.filter((b) => !b.disabled);
  let size = null;

  /**
   * Live availability.
   *
   * The pages are statically built, so the size buttons carry whatever stock
   * state was true at BUILD time. Stock changes constantly during a drop, so
   * without this a customer can pick a sold-out size, fill in the whole
   * checkout, and only be refused at the final step — by which point they have
   * done all the work and the shop looks broken.
   *
   * This asks the API for the current state and closes the sizes that are
   * gone. It is progressive enhancement in both directions: if the request
   * fails, the page behaves exactly as it did before, and the server still
   * refuses the order — the API is the authority either way. It only ever
   * REMOVES availability; it never re-opens a size the build marked sold out,
   * because a stale page must not start selling something on its own.
   */
  async function syncAvailability() {
    let live;
    try {
      const res = await fetch('/api/catalogue', { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      live = data.products?.find((p) => p.slug === slug);
    } catch {
      return; // offline, or a static deploy with no API — leave the page alone
    }
    if (!live?.sizes?.length) return;

    const soldOut = new Set(live.sizes.filter((s2) => !s2.available).map((s2) => s2.size));
    let closed = 0;

    for (const btn of sizeBtns) {
      if (!soldOut.has(btn.dataset.size) || btn.disabled) continue;
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.dataset.state = 'sold_out';
      btn.setAttribute('aria-label', `${btn.dataset.size} — sold out`);
      closed++;

      // If the customer had already chosen this size, un-choose it rather than
      // leaving a selected button they cannot buy.
      if (size === btn.dataset.size) {
        size = null;
        btn.setAttribute('aria-checked', 'false');
        if (addBtn) addBtn.disabled = true;
        if (hint) {
          hint.textContent = `Size ${btn.dataset.size} has just sold out. Choose another size.`;
          hint.classList.add('is-error');
        }
      }
    }

    if (closed) {
      selectable = sizeBtns.filter((b) => !b.disabled);
      // Keep the roving tabindex valid: a disabled button must not be the one
      // tab lands on.
      sizeBtns.forEach((b) => {
        b.tabIndex = b === selectable[0] ? 0 : -1;
      });
      if (!selectable.length && hint) {
        hint.textContent = 'Every size is sold out.';
      }
    }
  }

  const setSize = (btn) => {
    if (!btn || btn.disabled) return;
    size = btn.dataset.size;
    emit('size_select', { slug, size });
    sizeBtns.forEach((b) => {
      b.setAttribute('aria-checked', String(b === btn));
      b.tabIndex = b === btn ? 0 : -1;
    });
    if (hint) {
      hint.textContent = `Size ${size} selected.`;
      hint.classList.remove('is-error');
    }
    if (addBtn) addBtn.disabled = false;
  };

  // Roving tabindex: the group is one tab stop, arrows move within it.
  sizeBtns.forEach((b, i) => {
    b.tabIndex = i === 0 ? 0 : -1;
    b.addEventListener('click', () => setSize(b));
    if (b.disabled) {
      // A click on a sold-out size is demand for stock that is not there —
      // worth knowing, and the button being disabled means it is otherwise
      // invisible. The listener goes on the wrapper because a disabled button
      // does not fire click events itself.
      b.parentElement?.addEventListener('click', (event) => {
        if (event.target === b || b.contains(event.target)) {
          emit('size_unavailable', { slug, size: b.dataset.size });
        }
      });
    }
  });

  sizeGroup?.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const cur = selectable.indexOf(document.activeElement);
    let next;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = selectable.length - 1;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (cur + 1) % selectable.length;
    else next = (cur - 1 + selectable.length) % selectable.length;
    const target = selectable[Math.max(0, next)];
    target?.focus();
    setSize(target);
  });

  // Fire and forget: nothing on the page waits for it.
  syncAvailability();

  const qty = () => Math.min(99, Math.max(1, parseInt(qtyInput?.value, 10) || 1));
  const setQtyValue = (n) => {
    if (!qtyInput) return;
    qtyInput.value = String(Math.min(99, Math.max(1, n)));
    if (decBtn) decBtn.disabled = qtyInput.value === '1';
  };

  decBtn?.addEventListener('click', () => setQtyValue(qty() - 1));
  incBtn?.addEventListener('click', () => setQtyValue(qty() + 1));
  qtyInput?.addEventListener('change', () => setQtyValue(qty()));
  setQtyValue(1);

  const doAdd = () => {
    if (!size) {
      if (hint) {
        hint.textContent = 'Select a size to continue.';
        hint.classList.add('is-error');
      }
      selectable[0]?.focus();
      return;
    }
    const n = qty();
    add(slug, size, n);
    emit('add_to_cart', { slug, size, quantity: n });
    if (status) status.textContent = `Added ${n} × size ${size} to cart.`;
    openCart();
  };

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    doAdd();
  });
  // The sticky bar is a sibling of [data-product], not a child of it.
  document.querySelector('[data-sticky-add]')?.addEventListener('click', () => {
    if (!size) {
      form?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    doAdd();
  });

  /* --------------------------------------- sticky mobile buy bar (< 900) */

  const sticky = document.querySelector('[data-sticky-buy]');
  if (sticky && addBtn && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      ([entry]) => {
        sticky.hidden = entry.isIntersecting || window.innerWidth >= 900;
      },
      { threshold: 0 }
    );
    io.observe(addBtn);
  }
}
