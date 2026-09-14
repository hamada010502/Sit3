/** Persistent radio player: tab toggle, play/pause, volume. No autoplay. */

const root = document.querySelector('[data-radio]');
if (root) {
  const tab = root.querySelector('[data-radio-toggle]');
  const panel = root.querySelector('[data-radio-panel]');
  const closeBtn = root.querySelector('[data-radio-close]');
  const dot = root.querySelector('[data-radio-dot]');
  const audio = root.querySelector('[data-radio-audio]');
  const playBtn = root.querySelector('[data-radio-play]');
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
  if (audio && playBtn) {
    playBtn.addEventListener('click', () => {
      if (audio.paused) audio.play();
      else audio.pause();
    });

    audio.addEventListener('play', () => {
      dot?.classList.add('radio__dot--live');
      playBtn.classList.add('is-playing');
      playBtn.setAttribute('aria-label', playBtn.getAttribute('aria-label').replace('Play', 'Pause'));
    });

    audio.addEventListener('pause', () => {
      dot?.classList.remove('radio__dot--live');
      playBtn.classList.remove('is-playing');
      playBtn.setAttribute('aria-label', playBtn.getAttribute('aria-label').replace('Pause', 'Play'));
    });

    if (volume) {
      audio.volume = Number(volume.value);
      volume.addEventListener('input', () => {
        audio.volume = Number(volume.value);
      });
    }
  }
}
