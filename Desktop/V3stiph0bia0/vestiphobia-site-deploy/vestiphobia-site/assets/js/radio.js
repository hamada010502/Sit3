/**
 * Persistent radio player: tab toggle, vinyl + button play/pause, volume,
 * and "start on first interaction" autoplay-with-sound workaround.
 *
 * Literal page-load autoplay-with-sound is blocked by every browser, so
 * instead the very first click/scroll/keydown anywhere on the page tries
 * audio.play() once — unless the visitor has already used the radio's own
 * controls, in which case their choice (playing or paused) is left alone.
 */

const root = document.querySelector('[data-radio]');
if (root) {
  const tab = root.querySelector('[data-radio-toggle]');
  const panel = root.querySelector('[data-radio-panel]');
  const closeBtn = root.querySelector('[data-radio-close]');
  const dots = root.querySelectorAll('[data-radio-dot]');
  const audio = root.querySelector('[data-radio-audio]');
  const playBtn = root.querySelector('[data-radio-play]');
  const vinylBtn = root.querySelector('[data-radio-vinyl]');
  const volume = root.querySelector('[data-radio-volume]');

  const open = () => {
    panel.hidden = false;
    tab.setAttribute('aria-expanded', 'true');
  };

  const close = () => {
    panel.hidden = true;
    tab.setAttribute('aria-expanded', 'false');
  };

  tab.addEventListener('click', () => (panel.hidden ? open() : close()));
  closeBtn?.addEventListener('click', close);

  /* Only present when site.radio.streamUrl is set (the custom <audio> path);
     the iframe-embed fallback has no transport controls of its own here. */
  if (audio) {
    // True once the visitor has explicitly used play/pause themselves —
    // after that, their choice is respected and the page stops trying to
    // start playback on their behalf.
    let userControlled = false;

    const toggle = () => {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    };

    const onExplicitControl = () => {
      userControlled = true;
      disarmAutoStart();
      toggle();
    };

    playBtn?.addEventListener('click', onExplicitControl);
    vinylBtn?.addEventListener('click', onExplicitControl);

    audio.addEventListener('play', () => {
      dots.forEach((d) => d.classList.add('radio__dot--live'));
      root.classList.add('is-playing');
      playBtn?.classList.add('is-playing');
      const label = playBtn?.getAttribute('aria-label');
      if (label) playBtn.setAttribute('aria-label', label.replace('Play', 'Pause'));
      const vLabel = vinylBtn?.getAttribute('aria-label');
      if (vLabel) vinylBtn.setAttribute('aria-label', vLabel.replace('Play', 'Pause'));
    });

    audio.addEventListener('pause', () => {
      dots.forEach((d) => d.classList.remove('radio__dot--live'));
      root.classList.remove('is-playing');
      playBtn?.classList.remove('is-playing');
      const label = playBtn?.getAttribute('aria-label');
      if (label) playBtn.setAttribute('aria-label', label.replace('Pause', 'Play'));
      const vLabel = vinylBtn?.getAttribute('aria-label');
      if (vLabel) vinylBtn.setAttribute('aria-label', vLabel.replace('Pause', 'Play'));
    });

    if (volume) {
      audio.volume = Number(volume.value);
      volume.addEventListener('input', () => {
        audio.volume = Number(volume.value);
      });
    }

    // Start-on-first-interaction: a single one-time listener per event type,
    // all disarmed together the moment any of them fires (or the moment the
    // visitor touches the controls directly, whichever comes first) so this
    // never refires later in the visit.
    const autoStartEvents = ['click', 'scroll', 'keydown'];
    let autoStartArmed = true;

    function disarmAutoStart() {
      if (!autoStartArmed) return;
      autoStartArmed = false;
      autoStartEvents.forEach((ev) => document.removeEventListener(ev, autoStart));
    }

    function autoStart() {
      disarmAutoStart();
      if (userControlled) return;
      if (!audio.paused) return; // already playing — nothing to do
      // audio.play() can reject (autoplay policy, network hiccup); fail
      // silently either way, never as a console error or a stuck UI state.
      audio.play().catch(() => {});
    }

    autoStartEvents.forEach((ev) =>
      document.addEventListener(ev, autoStart, { once: true, passive: true })
    );
  }
}
