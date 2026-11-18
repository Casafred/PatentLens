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
})();
