// Ship PDF.js and its worker with the desktop app. The legacy reader can still
// assign its historic CDN URL; normalize that assignment to the bundled worker.
(function () {
  if (typeof pdfjsLib === "undefined") return;
  var options = pdfjsLib.GlobalWorkerOptions;
  var local = new URL("scripts/vendor/pdf.worker.min.js", document.baseURI).href;
  var workerSrc = local;
  Object.defineProperty(options, "workerSrc", {
    configurable: true,
    get: function () { return workerSrc; },
    set: function (value) {
      workerSrc = /cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\//.test(value) ? local : value;
    },
  });

  // PDFs whose fonts use predefined CID CMaps (common in USPTO/EPO filings)
  // cannot be convertToUnicode()'d without the bundled .bcmap files: pdf.js
  // then returns an empty text layer, so the page looks like a scan and cannot
  // be selected/copied. Always point getDocument at the local CMap folder.
  var cMapUrl = new URL("scripts/vendor/cmaps/", document.baseURI).href;
  var getDocument = pdfjsLib.getDocument;
  if (typeof getDocument === "function") {
    pdfjsLib.getDocument = function (source) {
      if (source && typeof source === "object" && !source.cMapUrl) {
        source = Object.assign({}, source, { cMapUrl: cMapUrl, cMapPacked: true });
      }
      return getDocument.call(pdfjsLib, source);
    };
  }
})();
