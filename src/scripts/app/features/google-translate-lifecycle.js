/* Bound the legacy translator lifecycle and suppress only known Google UI chrome. */
(function (root) {
  'use strict';
  var chrome = '.goog-te-spinner-pos,.goog-te-spinner,[class*="VIpgJd-ZVi9od-aZ2wEe"],[class*="VIpgJd-yAWNEb-L7lbkb"],iframe.VIpgJd-ZVi9od-ORHb-OEVmcd,iframe.goog-te-banner-frame,iframe.skiptranslate,#goog-gt-tt';
  var phase = null, serial = 0, status;
  function sweep() {
    document.querySelectorAll(chrome).forEach(function (el) {
      // Google writes inline !important styles repeatedly. Reapply instead of trusting a marker.
      ['display', 'visibility', 'pointer-events'].forEach(function (property, i) {
        var value = ['none', 'hidden', 'none'][i];
        if (el.style.getPropertyValue(property) !== value || el.style.getPropertyPriority(property) !== 'important') el.style.setProperty(property, value, 'important');
      });
      el.setAttribute('aria-hidden', 'true');
    });
  }
  function end(reason) {
    var previous = phase; phase = null; serial++;
    if (previous) { clearTimeout(previous.timeout); clearInterval(previous.poll); }
    if (status) status.hidden = true;
    sweep();
    if (reason && typeof showToast === 'function') showToast(reason);
  }
  function cancel(reason) {
    end();
    if (typeof _figLinkPollTimer !== 'undefined' && _figLinkPollTimer) { clearTimeout(_figLinkPollTimer); _figLinkPollTimer = null; }
    if (typeof _googleTranslateActive !== 'undefined') _googleTranslateActive = false;
    if (typeof _gtActivationTriggered !== 'undefined') _gtActivationTriggered = false;
    if (typeof _googleTranslateInjected !== 'undefined') _googleTranslateInjected = false;
    if (typeof _figLinkScope !== 'undefined') _figLinkScope = null;
    // Preserve the Google runtime while its queued callbacks drain; avoid deleting shared globals.
    if (typeof root._gentleDisableGt === 'function') root._gentleDisableGt();
    document.querySelectorAll('#google-translate-script,#google_translate_element').forEach(function (el) { el.remove(); });
    if (typeof root._updateGtButtonState === 'function') root._updateGtButtonState();
    sweep();
    if (reason && typeof showToast === 'function') showToast(reason);
  }
  function identity(scope) {
    var data = scope === 'popup' ? root._patentPopupData : root._currentPatentData;
    return data && (data.patent_number || data.publication_number || data.application_number) || '';
  }
  function begin(scope) {
    end();
    var token = ++serial;
    phase = { scope: scope, patent: identity(scope), token: token };
    status.hidden = false;
    phase.timeout = setTimeout(function () { if (phase && phase.token === token) cancel('网页翻译超时，已关闭加载状态，可重试'); }, 35000);
    phase.poll = setInterval(function () {
      if (!phase || phase.token !== token) return;
      if (identity(scope) !== phase.patent) { cancel(); return; }
      if (!_googleTranslateActive) end();
      sweep();
    }, 200);
  }
  function init() {
    var style = document.createElement('style'); style.id = 'pl-gt-lifecycle-style';
    style.textContent = chrome + '{display:none!important;visibility:hidden!important;pointer-events:none!important}#pl-translation-progress{position:fixed;top:78px;right:24px;z-index:100040;display:flex;align-items:center;gap:16px;padding:12px 16px;border:1px solid var(--border,#cbd5e1);border-radius:12px;background:var(--bg-primary,#fff);color:var(--text-primary,#234);box-shadow:0 6px 26px #0002;font:13px system-ui}#pl-translation-progress[hidden]{display:none}#pl-translation-progress button{font:inherit;cursor:pointer;color:inherit;background:transparent;border:1px solid var(--border,#aaa);padding:6px 10px;border-radius:7px}';
    document.head.appendChild(style);
    status = document.createElement('div'); status.id = 'pl-translation-progress'; status.className = 'notranslate'; status.hidden = true;
    status.innerHTML = '<span role="status">网页翻译中…</span><button type="button" aria-label="取消网页翻译并关闭加载状态">取消 / 关闭</button>';
    status.querySelector('button').onclick = function () { cancel('已取消网页翻译'); }; document.body.appendChild(status);
    var original = root.toggleGoogleTranslate;
    root.toggleGoogleTranslate = function (scope) {
      if (phase || _googleTranslateActive) { cancel('已取消网页翻译'); return; }
      scope = scope || (typeof _detectFigLinkScope === 'function' ? _detectFigLinkScope() : 'main');
      var value;
      try {
        begin(scope);
        value = original.apply(this, arguments);
        if (_googleTranslateActive) {
          var callback = root.googleTranslateElementInit, token = phase.token;
          if (callback) root.googleTranslateElementInit = function () { if (phase && phase.token === token) return callback.apply(this, arguments); };
        } else end();
      } catch (error) { cancel(); throw error; }
      return value;
    };
    ['_pollSelectGoogleTranslateLang', '_onGoogleTranslateActivated', '_pollForTranslationComplete'].forEach(function (name) {
      var fn = root[name]; if (!fn) return;
      root[name] = function () { if (!phase) return; return fn.apply(this, arguments); };
    });
    document.addEventListener('error', function (event) { if (event.target && event.target.id === 'google-translate-script') cancel('翻译组件加载失败，已关闭加载状态'); }, true);
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && phase) cancel('已取消网页翻译'); });
    var scheduled = false;
    new MutationObserver(function (records) {
      if (scheduled || !records.some(function (record) { return record.type === 'childList' || record.target.matches && record.target.matches(chrome); })) return;
      scheduled = true; queueMicrotask(function () { scheduled = false; sweep(); });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    root.GoogleTranslateLifecycle = { cancel: cancel, sweep: sweep, isActive: function () { return !!phase; } };
    sweep();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
