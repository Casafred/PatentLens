(function () {
  "use strict";

  // ── Claims translation state (module-scoped, separate from description state in web-app.js) ──
  var _claimsTranslated = false;
  var _claimsRestored = false;
  var _gtTargetTab = "description";
  var _originalClaimTexts = {};
  var _gtHardKilled = false;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function _getScopeRoot(scope) {
    return scope === "popup"
      ? document.getElementById("ppv-content")
      : document.getElementById("patent-detail-content");
  }

  function _getActiveTabForScope(scope) {
    var root = _getScopeRoot(scope);
    if (!root) return "description";
    var activeTab = root.querySelector(".pd-bookmark-tab.active");
    if (activeTab && activeTab.dataset.tab) {
      return activeTab.dataset.tab;
    }
    return "description";
  }

  function _getClaimsContainer(scope) {
    var root = _getScopeRoot(scope);
    if (!root) return null;
    return root.querySelector(".pd-claims-list");
  }

  function _getPatentData(scope) {
    return scope === "popup" ? window._patentPopupData : window._currentPatentData;
  }

  function _getCacheKey(scope) {
    var data = _getPatentData(scope);
    return data && data.patent_number ? data.patent_number : "_default_";
  }

  // ── Hard-kill GT internals ───────────────────────────────────────────────
  // Replaces window.google.translate with a no-op mock so GT's in-flight
  // callbacks (MutationObserver, promises) don't crash with
  // "Cannot read properties of undefined (reading 'J')".
  // Also removes GT script tags and disconnects GT iframes.

  function _hardKillGtInternals() {
    try {
      // 1. Replace window.google.translate with a no-op mock
      if (window.google && window.google.translate) {
        // Keep the structure but replace methods with no-ops
        var mockTranslateElement = function () {};
        mockTranslateElement.InlineLayout = { SIMPLE: 0, HORIZONTAL: 1, VERTICAL: 2 };
        window.google.translate.TranslateElement = mockTranslateElement;
        // Remove any other translate properties that might trigger callbacks
        try {
          delete window.google.translate.dom;
        } catch (_) {}
        try {
          delete window.google.translate.secure;
        } catch (_) {}
      }

      // 2. Remove GT script tags
      var gtScripts = document.querySelectorAll(
        'script#google-translate-script, script[src*="translate.google.com"], script[src*="translate_a/element.js"]'
      );
      gtScripts.forEach(function (s) {
        try { s.remove(); } catch (_) {}
      });

      // 3. Remove GT container element
      var gtContainer = document.getElementById("google_translate_element");
      if (gtContainer) {
        try { gtContainer.remove(); } catch (_) {}
      }

      // 4. Remove/hide all GT iframes (they contain the spinner)
      document.querySelectorAll("iframe.skiptranslate, iframe.goog-te-banner-frame, iframe[src*='translate.google']").forEach(function (iframe) {
        try {
          iframe.style.cssText = "display:none !important;visibility:hidden !important;width:0 !important;height:0 !important;position:absolute !important;top:-9999px !important;left:-9999px !important;";
          // Some iframes can't be removed (cross-origin), but we can hide them
          try { iframe.remove(); } catch (_) {}
        } catch (_) {}
      });

      // 5. Remove GT toolbar/container divs
      document.querySelectorAll(".goog-te-banner-frame, .goog-te-banner, .goog-te-balloon-frame, .goog-te-balloon, .goog-te-spinner-pos, .goog-te-spinner, .skiptranslate").forEach(function (el) {
        if (el.tagName !== "IFRAME") {
          try { el.remove(); } catch (_) {}
        }
      });

      _gtHardKilled = true;
      console.log("[GT-fixes] GT internals hard-killed (scripts removed, google.translate mocked)");
    } catch (e) {
      console.warn("[GT-fixes] error in _hardKillGtInternals:", e);
    }
  }

  // ── Save original global functions ───────────────────────────────────────

  var _origToggleGoogleTranslate = window.toggleGoogleTranslate;
  var _origProtectForTranslation = window._protectForTranslation;
  var _origPollForTranslationComplete = window._pollForTranslationComplete;
  var _origRestoreOriginalDescription = window.restoreOriginalDescription;
  var _origGentlyDisableGt = window._gentleDisableGt;
  var _origUpdateGtButtonState = window._updateGtButtonState;
  var _origPurgeGoogleTranslateCompletely = window._purgeGoogleTranslateCompletely;

  // ── Override: toggleGoogleTranslate ──────────────────────────────────────
  // Detect active tab before starting translation so claims can be translated.

  window.toggleGoogleTranslate = function (scope) {
    if (!scope) {
      scope = typeof _detectFigLinkScope === "function" ? _detectFigLinkScope() : "main";
    }

    var activeTab = _getActiveTabForScope(scope);

    if (activeTab === "claims") {
      _gtTargetTab = "claims";

      // Ignore clicks while GT is actively translating (matches original guard)
      if (_googleTranslateActive && !_claimsTranslated) {
        console.log("[GT-claims] translation in progress, ignoring toggle");
        return;
      }

      // If claims are already translated → restore original
      if (_claimsTranslated) {
        _claimsRestored = true;
        _claimsTranslated = false;
        _googleTranslateActive = false;
        restoreClaimsOriginal(scope);
        try { setComboToOriginal(); } catch (e) {}
        if (typeof _figLinkPollTimer !== "undefined" && _figLinkPollTimer) {
          clearTimeout(_figLinkPollTimer);
          _figLinkPollTimer = null;
        }
        if (typeof _gtActivationTriggered !== "undefined") _gtActivationTriggered = false;
        if (typeof _figLinkScope !== "undefined") _figLinkScope = null;
        window._updateGtButtonState();
        showToast("已恢复原文");
        return;
      }

      // If description is translated but claims aren't, the button shows
      // "恢复原文" — delegate to original to restore the description.
      if (_descTranslated) {
        _gtTargetTab = "description";
        return _origToggleGoogleTranslate.call(this, scope);
      }

      // If user restored original before → re-translate
      if (_claimsRestored) {
        _claimsRestored = false;
        var cc = _getClaimsContainer(scope);
        if (cc) {
          cc.classList.remove("notranslate");
          cc.removeAttribute("translate");
          delete cc.dataset.gtTranslated;
        }
        // Re-unprotect claim text elements
        if (cc) {
          cc.querySelectorAll(".pd-claim-text").forEach(function (el) {
            el.classList.remove("notranslate");
            el.removeAttribute("translate");
          });
        }
        if (typeof _gtActivationTriggered !== "undefined") _gtActivationTriggered = false;
        showToast("正在重新翻译…");
      }

      // Start GT translation for claims
      startClaimsTranslation(scope);
      return;
    }

    // Description tab (or overview/references) — use original flow
    _gtTargetTab = "description";
    _claimsTranslated = false;
    _claimsRestored = false;
    return _origToggleGoogleTranslate.call(this, scope);
  };

  // ── Claims translation flow ──────────────────────────────────────────────

  function startClaimsTranslation(scope) {
    // Protect everything except claims
    protectForClaimsTranslation(scope);

    // Set figLinkScope so polling knows the scope
    if (typeof _figLinkScope !== "undefined") {
      _figLinkScope = scope;
    }

    var combo = document.querySelector(".goog-te-combo");
    if (combo) {
      if (typeof _selectGoogleTranslateLang === "function") {
        _selectGoogleTranslateLang("zh-CN");
      }
      _googleTranslateActive = true;
      if (typeof _gtActivationTriggered !== "undefined") _gtActivationTriggered = true;
      window._updateGtButtonState();
      return;
    }

    // Set cookie and inject GT widget
    if (typeof _setGoogTransCookie === "function") {
      _setGoogTransCookie("/auto/zh-CN");
    }

    try {
      _googleTranslateInjected = true;
      _googleTranslateActive = true;
      _gtHardKilled = false;
      if (typeof _installGtChromeShield === "function") _installGtChromeShield();
      window._updateGtButtonState();

      var oldGt = document.getElementById("google_translate_element");
      if (oldGt) oldGt.remove();
      var oldScript = document.getElementById("google-translate-script");
      if (oldScript) oldScript.remove();

      var container = document.createElement("div");
      container.id = "google_translate_element";
      container.style.cssText = "position:fixed;top:-100px;left:0;z-index:999999;visibility:hidden;";
      document.body.prepend(container);

      window.googleTranslateElementInit = function () {
        try {
          new google.translate.TranslateElement({
            pageLanguage: "auto",
            includedLanguages: "zh-CN,zh-TW,en,ja,ko,de,fr",
            layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
            autoDisplay: true
          }, "google_translate_element");
        } catch (e) { console.warn("[GT] init error:", e); }
        if (typeof _pollSelectGoogleTranslateLang === "function") {
          _pollSelectGoogleTranslateLang("zh-CN", 0);
        }
      };

      var script = document.createElement("script");
      script.id = "google-translate-script";
      script.type = "text/javascript";
      script.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
      script.onerror = function () {
        showError("无法加载 Google 翻译组件，请检查网络连接（可能需要代理）");
        _googleTranslateInjected = false;
        _googleTranslateActive = false;
        container.remove();
        window._updateGtButtonState();
      };
      document.head.appendChild(script);
    } catch (e) {
      console.warn("[GT-claims] start translation error:", e);
      _googleTranslateActive = false;
      window._updateGtButtonState();
    }
  }

  // ── Protection for claims translation ────────────────────────────────────

  function protectForClaimsTranslation(scope) {
    // Run original protection first (protects everything except description)
    _origProtectForTranslation(scope);

    // Then swap: protect description, unprotect claims
    var root = _getScopeRoot(scope);
    if (!root) return;

    // Protect description panel
    var descPanel = root.querySelector('.pd-tab-panel[data-panel="description"]');
    if (descPanel) {
      descPanel.classList.add("notranslate");
      descPanel.setAttribute("translate", "no");
    }

    // Unprotect claims panel and its text content
    var claimsPanel = root.querySelector('.pd-tab-panel[data-panel="claims"]');
    if (claimsPanel) {
      claimsPanel.classList.remove("notranslate");
      claimsPanel.removeAttribute("translate");
    }

    // Protect claims panel header (title + buttons) but NOT claim text
    var claimsHeader = claimsPanel ? claimsPanel.querySelector(".pd-panel-header") : null;
    if (claimsHeader) {
      claimsHeader.classList.add("notranslate");
      claimsHeader.setAttribute("translate", "no");
    }

    // Protect group headers ("独立权利要求 N")
    var groupHeaders = root.querySelectorAll(".pd-claim-group-header");
    groupHeaders.forEach(function (el) {
      el.classList.add("notranslate");
      el.setAttribute("translate", "no");
    });

    // Protect dependent count/collapse buttons
    var countBtns = root.querySelectorAll(".pd-claim-dependent-count, .pd-claim-collapse-btn");
    countBtns.forEach(function (el) {
      el.classList.add("notranslate");
      el.setAttribute("translate", "no");
    });

    // Protect claim number and type labels
    var claimNums = root.querySelectorAll(".pd-claim-num, .pd-claim-type, .pd-claim-translate-btn");
    claimNums.forEach(function (el) {
      el.classList.add("notranslate");
      el.setAttribute("translate", "no");
    });

    // Make sure claim text elements are translatable
    var claimTexts = root.querySelectorAll(".pd-claim-text");
    claimTexts.forEach(function (el) {
      el.classList.remove("notranslate");
      el.removeAttribute("translate");
    });
  }

  // ── Override: _pollForTranslationComplete ────────────────────────────────
  // For claims, check the claims container for <font> tags.
  // Also fix: when polling exhausts, always clean up GT (fixes spinner issue).

  window._pollForTranslationComplete = function (scope) {
    if (_gtTargetTab !== "claims") {
      // Description flow: run original polling
      _origPollForTranslationComplete.call(this, scope);
      // Fix: if polling exhausted without successful capture, clean up GT
      // so the floating spinner doesn't spin forever.
      if (
        _googleTranslateActive &&
        !_descTranslated &&
        (!_figLinkPollTimer || _figLinkPollTimer === null) &&
        _figLinkPollCount >= _figLinkPollMax
      ) {
        console.warn("[GT-fixes] description poll exhausted, cleaning up GT");
        cleanupAfterTranslationFailure();
      }
      return;
    }

    // Claims translation polling
    var container = _getClaimsContainer(scope);
    if (!container) {
      console.warn("[GT-claims] claims container not found during poll");
      cleanupAfterTranslationFailure();
      return;
    }

    if (typeof _figLinkPollCount !== "undefined") _figLinkPollCount++;
    var hasFonts = container.querySelector("font");
    var claimTextEls = container.querySelectorAll(".pd-claim-text");
    var translatedCount = 0;
    claimTextEls.forEach(function (el) {
      if (el.querySelector("font")) translatedCount++;
    });

    var currentText = (container.textContent || "").trim();
    var textLength = currentText.length;
    var textChanged = currentText !== (typeof _figLinkLastTextSnapshot !== "undefined" ? _figLinkLastTextSnapshot : "");

    console.log("[GT-claims] poll #" + (typeof _figLinkPollCount !== "undefined" ? _figLinkPollCount : "?"),
      "hasFonts=" + !!hasFonts,
      "translatedClaims=" + translatedCount + "/" + claimTextEls.length,
      "textLen=" + textLength,
      "changed=" + textChanged);

    if (typeof _figLinkLastTextSnapshot !== "undefined") _figLinkLastTextSnapshot = currentText;

    // Translation complete when most claims have <font> tags AND text is stable
    var enoughTranslated = claimTextEls.length > 0 && translatedCount >= Math.ceil(claimTextEls.length * 0.6);
    if (hasFonts && enoughTranslated && !textChanged && textLength > 20) {
      if (typeof _figLinkStableCount !== "undefined") _figLinkStableCount = (_figLinkStableCount || 0) + 1;
      if ((typeof _figLinkStableCount !== "undefined" ? _figLinkStableCount : 0) >= 2) {
        if (typeof _figLinkStableCount !== "undefined") _figLinkStableCount = 0;
        console.log("[GT-claims] translation stable, capturing...");
        captureAndApplyClaimsTranslation(scope);
        return;
      }
    } else {
      if (typeof _figLinkStableCount !== "undefined") _figLinkStableCount = 0;
    }

    // Poll exhausted — always clean up GT to stop spinner and restore scroll
    var maxPolls = typeof _figLinkPollMax !== "undefined" ? _figLinkPollMax : 30;
    if ((typeof _figLinkPollCount !== "undefined" ? _figLinkPollCount : 0) >= maxPolls) {
      console.warn("[GT-claims] poll exhausted, cleaning up GT");
      if (hasFonts && translatedCount > 0) {
        // Partial translation available — capture what we have
        captureAndApplyClaimsTranslation(scope);
      } else {
        cleanupAfterTranslationFailure();
      }
      return;
    }

    if (typeof _figLinkPollTimer !== "undefined") {
      _figLinkPollTimer = setTimeout(function () {
        window._pollForTranslationComplete(scope);
      }, typeof _figLinkPollInterval !== "undefined" ? _figLinkPollInterval : 1000);
    }
  };

  // ── Capture and apply claims translation ─────────────────────────────────

  function captureAndApplyClaimsTranslation(scope) {
    var container = _getClaimsContainer(scope);
    if (!container) {
      cleanupAfterTranslationFailure();
      return;
    }

    var claimTextEls = container.querySelectorAll(".pd-claim-text");
    if (claimTextEls.length === 0) {
      cleanupAfterTranslationFailure();
      return;
    }

    var cacheKey = _getCacheKey(scope);
    if (!_originalClaimTexts[cacheKey]) {
      _originalClaimTexts[cacheKey] = [];
    }

    var translatedCount = 0;
    claimTextEls.forEach(function (el, idx) {
      // Store original text on first pass
      if (!_originalClaimTexts[cacheKey][idx]) {
        _originalClaimTexts[cacheKey][idx] = el.textContent || "";
      }

      // Get translated text (GT wraps text in <font> tags)
      var translatedText = (el.textContent || "").trim();
      if (translatedText && translatedText.length > 5 && el.querySelector("font")) {
        // Only update if translation looks different from original
        var original = _originalClaimTexts[cacheKey][idx];
        if (translatedText !== original.trim()) {
          el.textContent = translatedText;
          el.dataset.translated = "true";
          translatedCount++;
        }
      }
    });

    console.log("[GT-claims] captured " + translatedCount + " translated claims");

    if (translatedCount === 0) {
      cleanupAfterTranslationFailure();
      return;
    }

    // Mark claims container as translated and freeze it
    container.classList.add("notranslate");
    container.setAttribute("translate", "no");
    container.dataset.gtTranslated = "true";

    // Cache on patent data
    var data = _getPatentData(scope);
    if (data) {
      data._translatedClaims = true;
    }

    _claimsTranslated = true;
    _claimsRestored = false;

    // Gently disable GT, then hard-kill to stop the spinner
    if (typeof _gentleDisableGt === "function") _gentleDisableGt();
    _googleTranslateActive = false;
    if (typeof _gtActivationTriggered !== "undefined") _gtActivationTriggered = false;
    if (typeof _figLinkPollTimer !== "undefined" && _figLinkPollTimer) {
      clearTimeout(_figLinkPollTimer);
      _figLinkPollTimer = null;
    }
    // Hard-kill GT internals after capture to stop the spinner
    setTimeout(function () { _hardKillGtInternals(); }, 500);
    window._updateGtButtonState();
    showToast("权利要求已翻译");
  }

  // ── Restore original claims text ─────────────────────────────────────────

  function restoreClaimsOriginal(scope) {
    var cacheKey = _getCacheKey(scope);
    var originals = _originalClaimTexts[cacheKey];
    if (!originals) return;

    var container = _getClaimsContainer(scope);
    if (!container) return;

    var claimTextEls = container.querySelectorAll(".pd-claim-text");
    claimTextEls.forEach(function (el, idx) {
      if (originals[idx]) {
        el.textContent = originals[idx];
        delete el.dataset.translated;
      }
    });

    // Unfreeze so re-translation is possible
    container.classList.remove("notranslate");
    container.removeAttribute("translate");
    delete container.dataset.gtTranslated;

    var data = _getPatentData(scope);
    if (data) {
      data._translatedClaims = false;
    }

    _claimsTranslated = false;
  }

  // ── Cleanup when translation fails ───────────────────────────────────────

  function cleanupAfterTranslationFailure() {
    console.warn("[GT-fixes] translation failed or timed out, cleaning up");
    try {
      if (typeof _gentleDisableGt === "function") {
        _gentleDisableGt();
      } else if (typeof _purgeGoogleTranslateCompletely === "function") {
        _purgeGoogleTranslateCompletely();
      }
    } catch (e) {
      console.warn("[GT-fixes] cleanup error:", e);
    }
    _googleTranslateActive = false;
    if (typeof _gtActivationTriggered !== "undefined") _gtActivationTriggered = false;
    if (typeof _figLinkPollTimer !== "undefined" && _figLinkPollTimer) {
      clearTimeout(_figLinkPollTimer);
      _figLinkPollTimer = null;
    }
    // Hard-kill GT to stop the spinner
    _hardKillGtInternals();
    window._updateGtButtonState();
  }

  // ── Override: restoreOriginalDescription ─────────────────────────────────
  // Also restore claims when restoring original text.

  window.restoreOriginalDescription = function (scope) {
    // Always restore description (original behavior)
    _origRestoreOriginalDescription.call(this, scope);

    // Also restore claims if they were translated
    if (_claimsTranslated) {
      restoreClaimsOriginal(scope);
      _claimsTranslated = false;
      _claimsRestored = true;
    }
  };

  // ── Override: _updateGtButtonState ───────────────────────────────────────
  // Handle claims translation state in the button.

  window._updateGtButtonState = function () {
    var allBtns = document.querySelectorAll(
      '.pd-header-link[onclick*="toggleGoogleTranslate"], #ppv-translate-btn'
    );
    allBtns.forEach(function (btn) {
      if (_googleTranslateActive) {
        btn.textContent = "翻译中…";
        btn.classList.add("gt-active");
      } else if (_claimsTranslated || _descTranslated) {
        btn.textContent = "恢复原文";
        btn.classList.add("gt-active");
      } else if (_descRestored && window._currentPatentData && window._currentPatentData._translatedDescription) {
        btn.textContent = "恢复译文";
        btn.classList.add("gt-active");
      } else {
        btn.textContent = "网页翻译";
        btn.classList.remove("gt-active");
      }
    });
  };

  // ── Override: _gentleDisableGt ───────────────────────────────────────────
  // Fix: Also reset overflow on body and documentElement to fix scroll lock.
  // Add additional GT spinner selectors that may not be covered.

  window._gentleDisableGt = function () {
    // Call original first
    _origGentlyDisableGt.call(this);

    try {
      // Reset ALL body styles GT may have set (fixes scroll lock issue)
      document.body.style.top = "";
      document.body.style.position = "";
      document.body.style.overflow = "";
      document.body.style.overflowX = "";
      document.body.style.marginTop = "";
      document.body.style.paddingTop = "";

      // Reset html element styles too
      var htmlEl = document.documentElement;
      if (htmlEl) {
        htmlEl.style.overflow = "";
        htmlEl.style.overflowX = "";
        htmlEl.style.position = "";
        htmlEl.style.top = "";
        htmlEl.style.marginTop = "";
        htmlEl.style.paddingTop = "";
      }

      // Remove GT classes from html/body
      document.body.classList.remove("translated-ltr", "translated-rtl", "translated", "goog-te-popup");
      if (htmlEl) {
        htmlEl.classList.remove("translated-ltr", "translated-rtl", "translated", "goog-te-popup");
      }

      // Additional sweep for any GT spinner/loading elements that might appear
      var extraSelectors = [
        ".goog-te-spinner-pos", ".goog-te-spinner", ".gt-spinner", ".gt-loading",
        ".goog-te-banner-frame", ".goog-te-banner", "iframe.goog-te-banner-frame",
        "#goog-gt-tt", ".goog-te-balloon", ".goog-te-balloon-frame", ".goog-te-pos",
        ".goog-te-menu2", ".goog-te-ftab-float", "iframe.goog-te-menu-frame",
        "iframe[src*='translate.google']",
        ".goog-tooltip", ".goog-text-highlight",
        "#goog-gt-vt", "#goog-gt-bc"
      ];
      var HIDE_STYLE = "display:none !important;visibility:hidden !important;opacity:0 !important;pointer-events:none !important;height:0 !important;width:0 !important;overflow:hidden !important;position:absolute !important;top:-9999px !important;left:-9999px !important;";
      extraSelectors.forEach(function (sel) {
        try {
          document.querySelectorAll(sel).forEach(function (el) {
            if (!el.dataset.gtHiddenFix) {
              el.style.cssText += ";" + HIDE_STYLE;
              el.dataset.gtHiddenFix = "1";
            }
          });
        } catch (_) {}
      });

      // Remove skiptranslate iframes that GT leaves behind
      document.querySelectorAll("iframe.skiptranslate").forEach(function (el) {
        try {
          if (!el.dataset.gtHiddenFix) {
            el.style.cssText += ";" + HIDE_STYLE;
            el.dataset.gtHiddenFix = "1";
          }
        } catch (_) {}
      });

      window.scrollTo(window.scrollX, window.scrollY);
    } catch (e) {
      console.warn("[GT-fixes] error in enhanced _gentleDisableGt:", e);
    }
  };

  // ── Override: _purgeGoogleTranslateCompletely ────────────────────────────
  // Enhanced: hard-kill GT internals + reset scroll styles on full purge.

  if (window._purgeGoogleTranslateCompletely) {
    window._purgeGoogleTranslateCompletely = function () {
      _origPurgeGoogleTranslateCompletely.call(this);
      try {
        // Hard-kill GT internals to stop the spinner and prevent
        // "Cannot read properties of undefined (reading 'J')" errors
        _hardKillGtInternals();

        // Reset scroll styles
        document.body.style.overflow = "";
        document.body.style.overflowX = "";
        document.body.style.marginTop = "";
        document.body.style.paddingTop = "";
        document.body.style.top = "";
        document.body.style.position = "";
        var htmlEl = document.documentElement;
        if (htmlEl) {
          htmlEl.style.overflow = "";
          htmlEl.style.overflowX = "";
          htmlEl.style.position = "";
          htmlEl.style.top = "";
          htmlEl.style.marginTop = "";
          htmlEl.style.paddingTop = "";
          htmlEl.classList.remove("translated-ltr", "translated-rtl", "translated", "goog-te-popup");
        }
        document.body.classList.remove("translated-ltr", "translated-rtl", "translated", "goog-te-popup");
      } catch (_) {}
    };
  }

  // ── Install enhanced CSS shield ──────────────────────────────────────────
  (function installEnhancedGtCssShield() {
    var styleId = "gt-translation-fixes-shield";
    if (document.getElementById(styleId)) return;
    var style = document.createElement("style");
    style.id = styleId;
    style.textContent = [
      "html, body {",
      "  overflow-x: hidden !important;",
      "  position: static !important;",
      "  top: 0 !important;",
      "  margin-top: 0 !important;",
      "  padding-top: 0 !important;",
      "}",
      "/* Hide all GT chrome including newer variants */",
      ".goog-te-spinner-pos, .goog-te-spinner, .gt-spinner, .gt-loading,",
      ".goog-te-banner-frame, .goog-te-banner, iframe.goog-te-banner-frame,",
      "#goog-gt-tt, #goog-gt-vt, #goog-gt-bc,",
      ".goog-te-balloon, .goog-te-balloon-frame, .goog-te-pos,",
      ".goog-te-menu2, .goog-te-ftab-float, iframe.goog-te-menu-frame,",
      ".goog-tooltip, .goog-text-highlight,",
      "iframe[src*='translate.google.com'], iframe.skiptranslate {",
      "  display: none !important;",
      "  visibility: hidden !important;",
      "  opacity: 0 !important;",
      "  pointer-events: none !important;",
      "  width: 0 !important;",
      "  height: 0 !important;",
      "  position: absolute !important;",
      "  top: -9999px !important;",
      "  left: -9999px !important;",
      "  overflow: hidden !important;",
      "  z-index: -1 !important;",
      "}",
      "/* Main patent detail: let the page scroll naturally instead of trapping scroll in the tab panel.",
      "   The popup viewer (#ppv-content) keeps its internal scroll container. */",
      "#patent-detail-content .pd-tab-panel.active:not(.pd-split-view) {",
      "  overflow-y: visible !important;",
      "  max-height: none !important;",
      "}"
    ].join("\n");
    document.head.appendChild(style);
  })();

  // ── Reset claims state when new patent is rendered ───────────────────────
  var _origRenderPatentDetail = window.renderPatentDetail;
  if (_origRenderPatentDetail) {
    window.renderPatentDetail = function (data) {
      _claimsTranslated = false;
      _claimsRestored = false;
      _gtTargetTab = "description";
      return _origRenderPatentDetail.call(this, data);
    };
  }

  // Also reset when ppv opens/switches patents
  var _origOpenPatentPopup = window.openPatentPopup;
  if (_origOpenPatentPopup) {
    window.openPatentPopup = function () {
      _claimsTranslated = false;
      _claimsRestored = false;
      _gtTargetTab = "description";
      return _origOpenPatentPopup.apply(this, arguments);
    };
  }

  // ── Patch switchPpvTab and switchPatentTab to reset target tab ───────────
  var _origSwitchPpvTab = window.switchPpvTab;
  if (_origSwitchPpvTab) {
    window.switchPpvTab = function (tabName) {
      if (tabName !== "claims") _gtTargetTab = "description";
      return _origSwitchPpvTab.call(this, tabName);
    };
  }

  var _origSwitchPatentTab = window.switchPatentTab;
  if (_origSwitchPatentTab) {
    window.switchPatentTab = function (tabName) {
      if (tabName !== "claims") _gtTargetTab = "description";
      return _origSwitchPatentTab.call(this, tabName);
    };
  }

  // ── Global back-to-top button ────────────────────────────────────────────
  (function installBackToTopButton() {
    var btnId = "gt-fixes-back-to-top";
    if (document.getElementById(btnId)) return;

    var btn = document.createElement("button");
    btn.id = btnId;
    btn.title = "回到顶部";
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';
    btn.style.cssText = [
      "position: fixed",
      "bottom: 32px",
      "right: 32px",
      "z-index: 9999",
      "width: 44px",
      "height: 44px",
      "border-radius: 50%",
      "border: 1px solid var(--border, #3a3d4a)",
      "background: var(--bg-secondary, #1a1d2a)",
      "color: var(--text-primary, #e0e0e0)",
      "cursor: pointer",
      "display: none",
      "align-items: center",
      "justify-content: center",
      "box-shadow: 0 4px 12px rgba(0,0,0,0.3)",
      "transition: opacity 0.25s, transform 0.25s",
      "opacity: 0"
    ].join(";");

    document.body.appendChild(btn);

    // Show/hide based on scroll position
    function updateVisibility() {
      if (window.scrollY > 300) {
        btn.style.display = "flex";
        // Force reflow then set opacity for transition
        void btn.offsetHeight;
        btn.style.opacity = "1";
      } else {
        btn.style.opacity = "0";
        setTimeout(function () {
          if (window.scrollY <= 300) btn.style.display = "none";
        }, 250);
      }
    }

    // Throttle scroll listener
    var _scrollTimer = null;
    window.addEventListener("scroll", function () {
      if (_scrollTimer) return;
      _scrollTimer = setTimeout(function () {
        _scrollTimer = null;
        updateVisibility();
      }, 100);
    }, { passive: true });

    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    // Initial check
    updateVisibility();
  })();

  console.log("[GT-fixes] GT translation fixes module v2 loaded (claims support + hard-kill + scroll fixes + back-to-top)");
})();
