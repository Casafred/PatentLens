/*!
 * PatentLens - 同族专利跳转审查文档
 *
 * 在审查文档模式「概览 → 同族专利」中，把同族成员的申请号/公开号渲染为链接。
 * 点击后以新的审查文档标签页查询该同族专利（走 GD/EPO 降级流程）。
 *
 * web-app.js 已冻结；这里通过运行时包装 renderFamily 注入链接，不修改 legacy 文件。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeQuery(value) {
    return String(value || "").trim().toUpperCase().replace(/[\s\u00a0]+/g, "");
  }

  function publicationOf(member) {
    if (!member) return "";
    var office = String(member.countryCode || member.office || "").toUpperCase();
    var pub = String(member.publicationNumber || "").trim();
    if (!pub && Array.isArray(member.pubList) && member.pubList.length > 0) {
      var item = member.pubList[0] || {};
      var country = String(item.pubCountry || office || "").toUpperCase();
      var number = String(item.pubNum || item.publicationNumber || "").trim();
      if (number) pub = (/^[A-Z]{2}/i.test(number) ? number : country + number);
    }
    return normalizeQuery(pub);
  }

  function applicationOf(member) {
    if (!member) return "";
    var office = String(member.countryCode || member.office || "").toUpperCase();
    var app = member.appNum || member.applicationNumber || member.docNumber || "";
    if (!app && member.docNum && typeof member.docNum === "object") {
      app = member.docNum.docNumber || "";
    }
    var value = normalizeQuery(app);
    if (!value) return "";
    return /^[A-Z]{2}/.test(value) ? value : office + value;
  }

  function queryForMember(member) {
    // 优先公开号：GD 对公开号查询更稳定，且跨局格式统一。
    return publicationOf(member) || applicationOf(member);
  }

  function gdUrlForMember(member) {
    var office = String((member && (member.countryCode || member.office)) || "").toUpperCase();
    var pub = publicationOf(member);
    var app = applicationOf(member);
    var type = pub ? "publication" : "application";
    var number = pub || app;
    if (!office || !number) return "";

    if (office === "WO" || /^PCT/i.test(number)) {
      office = "WIPO";
      number = number.replace(/^(WO|PCT)/i, "").replace(/\//g, "");
      type = "application";
    }
    number = number.replace(/^[A-Z]{2}/, "");
    return "https://globaldossier.uspto.gov/#/result/" + type + "/"
      + encodeURIComponent(office) + "/"
      + encodeURIComponent(number) + "/"
      + (Math.floor(Math.random() * 65000) + 1);
  }

  function openExternalGd(member) {
    var url = gdUrlForMember(member);
    if (!url) return;
    try {
      if (window.electronAPI && typeof window.electronAPI.openExternal === "function") {
        window.electronAPI.openExternal(url);
        return;
      }
    } catch (_) {}
    window.open(url, "_blank");
  }

  function decorateFamilyLinks(data) {
    var container = document.getElementById("family-content");
    if (!container) return;
    var family = data && data.family;
    var members = [];
    try {
      if (typeof window.extractFamilyMembers === "function") {
        members = window.extractFamilyMembers(family);
      } else if (family && Array.isArray(family.list)) {
        members = family.list;
      }
    } catch (_) {}

    var memberEls = container.querySelectorAll(".family-member");
    memberEls.forEach(function (el, index) {
      var member = members[index];
      var pubQuery = publicationOf(member);
      var appQuery = applicationOf(member) || pubQuery;
      if (!pubQuery && !appQuery) return;

      var appNumEl = el.querySelector(".family-member-num");
      var appText = appNumEl ? appNumEl.textContent.trim() : "";
      if (appNumEl && appText && appQuery && !appNumEl.querySelector("a")) {
        appNumEl.innerHTML = '<a class="family-member-link" href="#" data-patent="' + escapeHtml(appQuery) +
          '" title="在新标签页查询该同族专利的审查文档">' + escapeHtml(appText) + "</a>";
      }

      var pubNum = publicationOf(member);
      var info = el.querySelector(".family-member-info");
      if (info && pubNum) {
        info.querySelectorAll("span").forEach(function (span) {
          if (span.textContent.indexOf("公开号") !== -1 && !span.querySelector("a")) {
            span.innerHTML = "公开号: <a class=\"family-member-link\" href=\"#\" data-patent=\"" +
              escapeHtml(pubQuery || appQuery) + "\" title=\"在新标签页查询该同族专利的审查文档\">" +
              escapeHtml(pubNum) + "</a>";
          }
        });
      }

      // 额外的 GD 外链：在浏览器新标签页打开 Global Dossier 页面
      var header = el.querySelector(".family-member-header");
      var gdUrl = gdUrlForMember(member);
      if (header && gdUrl && !header.querySelector(".family-member-gd")) {
        var gdLink = document.createElement("a");
        gdLink.className = "family-member-gd";
        gdLink.href = gdUrl;
        gdLink.target = "_blank";
        gdLink.rel = "noopener";
        gdLink.textContent = "GD ↗";
        gdLink.title = "在 GD 页面新标签页查询该同族专利的审查文档";
        gdLink.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          openExternalGd(member);
        });
        header.appendChild(gdLink);
      }
    });
  }

  function openDossierForPatent(patentNumber) {
    var pn = String(patentNumber || "").trim();
    if (!pn) return;
    if (typeof window.restoreFromHistory === "function") {
      window.restoreFromHistory(pn);
      return;
    }
    if (typeof window.doRestoreFromHistory === "function") {
      window.doRestoreFromHistory(pn);
    }
  }

  function bindClick() {
    var container = document.getElementById("family-content");
    if (!container || container.dataset.familyLinksBound) return;
    container.dataset.familyLinksBound = "1";
    container.addEventListener("click", function (event) {
      var link = event.target && event.target.closest ? event.target.closest(".family-member-link") : null;
      if (!link) return;
      event.preventDefault();
      openDossierForPatent(link.getAttribute("data-patent"));
    });
  }

  function wrapRenderFamily() {
    if (typeof window.renderFamily !== "function" || window.renderFamily.__familyLinksWrapped) return;
    var original = window.renderFamily;
    var wrapped = function (data) {
      var result = original.apply(this, arguments);
      try {
        decorateFamilyLinks(data);
        bindClick();
      } catch (_) {}
      return result;
    };
    wrapped.__familyLinksWrapped = true;
    window.renderFamily = wrapped;
  }

  function init() {
    wrapRenderFamily();
    bindClick();
  }

  window.PatentLensFamilyLinks = {
    queryForMember: queryForMember,
    gdUrlForMember: gdUrlForMember,
    openDossierForPatent: openDossierForPatent,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
