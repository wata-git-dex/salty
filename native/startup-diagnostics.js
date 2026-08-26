(() => {
  const failures = [];
  const describe = value => value?.stack || value?.message || String(value || 'Unknown startup error');

  function reveal(message) {
    console.error('[Sodium native startup]', message);
    const boot = document.getElementById('boot');
    if (!boot) return;
    boot.classList.remove('hidden', 'ready');
    boot.innerHTML = `
      <img class="boot-mark" src="./icon-ink.svg" alt="Sodium">
      <div style="max-width:320px;padding:0 24px;color:#dbe8ef;font:700 14px/1.45 -apple-system,sans-serif">
        Sodium could not finish opening.<br>
        <small style="display:block;margin-top:8px;color:#85a0b2;font-weight:500">Close and reopen the app. If this keeps happening, send a screenshot through Beta Feedback.</small>
      </div>`;
  }

  window.addEventListener('error', event => {
    failures.push(describe(event.error || event.message));
    reveal(failures.at(-1));
  });
  window.addEventListener('unhandledrejection', event => {
    failures.push(describe(event.reason));
    reveal(failures.at(-1));
  });

  window.setTimeout(() => {
    if (failures.length) return;
    const roots = ['welcome', 'consentScreen', 'authScreen', 'verifyScreen', 'guestClipScreen', 'profileSetup', 'app'];
    const visible = roots.find(id => {
      const node = document.getElementById(id);
      return node && !node.classList.contains('hidden') && node.getBoundingClientRect().height > 0;
    });
    if (!visible) reveal('Startup timed out before a screen became visible.');
  }, 8000);
})();
