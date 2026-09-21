/* PatentLens - AI 一键解读说明书上下文增强 */
(function () {
  "use strict";

  var MAX_DESCRIPTION_CHARS = 18000;

  function install() {
    if (typeof window.runPatentInterpretation !== "function" || window.runPatentInterpretation._descriptionContextEnhanced) return;
    var original = window.runPatentInterpretation;
    var enhanced = function (source, forceRefresh) {
      var data = source === "popup" ? window._patentPopupData : window._currentPatentData;
      if (!data || !data.description || !String(data.description).trim()) return original(source, forceRefresh);
      var oldAbstract = data.abstract;
      var description = String(data.description).trim();
      if (description.length > MAX_DESCRIPTION_CHARS) description = description.slice(0, MAX_DESCRIPTION_CHARS) + "\n…（说明书过长，已截断）";
      data.abstract = (oldAbstract || "（无摘要）") + "\n\n【说明书上下文：用于识别技术问题、明确技术效果及其证据】\n" + description;
      return Promise.resolve(original(source, forceRefresh)).finally(function () {
        data.abstract = oldAbstract;
      });
    };
    enhanced._descriptionContextEnhanced = true;
    window.runPatentInterpretation = enhanced;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
