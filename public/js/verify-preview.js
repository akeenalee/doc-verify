// Mobile browsers (Android Chrome, iOS Safari) don't render PDFs inside
// an iframe, so render the pages to canvas with PDF.js there.
(function () {
  var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!mobile) return;
  var wrap = document.getElementById('docFrameWrap');
  var pages = document.getElementById('docPages');
  var s = document.createElement('script');
  s.src = '/vendor/pdfjs/pdf.min.js';
  s.onload = function () {
    var lib = window.pdfjsLib;
    if (!lib) return;
    lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
    lib.getDocument({ url: pages.getAttribute('data-src'), isEvalSupported: false })
      .promise.then(function (pdf) {
        wrap.remove();
        pages.style.display = 'block';
        var dpr = window.devicePixelRatio || 1;
        var chain = Promise.resolve();
        for (var i = 1; i <= pdf.numPages; i++) {
          (function (n) {
            chain = chain.then(function () { return pdf.getPage(n); }).then(function (page) {
              var base = page.getViewport({ scale: 1 });
              var scale = (pages.clientWidth || 360) / base.width;
              var vp = page.getViewport({ scale: scale * dpr });
              var c = document.createElement('canvas');
              c.width = vp.width; c.height = vp.height;
              c.style.width = '100%'; c.style.display = 'block';
              pages.appendChild(c);
              return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            });
          })(i);
        }
      })
      .catch(function (e) { console.error('PDF render failed', e); });
  };
  document.head.appendChild(s);
})();
