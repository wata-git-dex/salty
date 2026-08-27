(() => {
  const failures = [];
  const describe = value => value?.stack || value?.message || String(value || 'Unknown startup error');
  const safeDetail = value => String(value || 'Unknown startup error')
    .replace(/(access_token|refresh_token|code)=([^&\s]+)/gi, '$1=[hidden]')
    .slice(0, 320);

  function reveal(message) {
    const detail = safeDetail(message);
    console.error('[Sodium native startup]', detail);
    try {
      window.Capacitor?.Plugins?.SodiumAuth?.logDiagnostic?.({ message:detail });
    } catch (_error) {}
    try {
      window.webkit?.messageHandlers?.sodiumDiagnostic?.postMessage(detail);
    } catch (_error) {}
    const boot = document.getElementById('boot');
    if (!boot) return;
    boot.classList.remove('hidden', 'ready');
    boot.innerHTML = `
      <img class="boot-mark" src="./icon-ink.svg" alt="Sodium">
      <div style="max-width:320px;padding:0 24px;color:#dbe8ef;font:700 14px/1.45 -apple-system,sans-serif">
        Sodium could not finish opening.<br>
        <small style="display:block;margin-top:8px;color:#85a0b2;font-weight:500">${detail}</small>
        <button type="button" onclick="location.reload()" style="margin-top:16px;padding:11px 18px;border:1px solid #3c6279;border-radius:12px;background:#122b3b;color:#dbe8ef;font:700 14px -apple-system,sans-serif">Retry Sodium</button>
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

  // A signed-in cold launch loads the member's sessions, Stoke, events, chat,
  // profiles, and settings before revealing the app. Mobile service can make
  // that legitimately take longer than eight seconds; treating it as a crash
  // replaced a healthy launch with a false error screen. Actual JS failures
  // are still reported immediately by the handlers above.
  window.setTimeout(() => {
    if (failures.length) return;
    const roots = ['welcome', 'consentScreen', 'authScreen', 'verifyScreen', 'guestClipScreen', 'profileSetup', 'app'];
    const visible = roots.find(id => {
      const node = document.getElementById(id);
      return node && !node.classList.contains('hidden') && node.getBoundingClientRect().height > 0;
    });
    if (!visible) reveal('Startup timed out before a screen became visible.');
  }, 30000);
})();
