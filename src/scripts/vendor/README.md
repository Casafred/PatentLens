PDF.js 3.11.174, Mozilla Foundation, Apache-2.0.

The original license notices remain at the start of both files. Sources:

- https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
- https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js
- https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/ (CMap files)

SHA-256:

```
5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946  pdf.min.js
feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b  pdf.worker.min.js
```

`cmaps/*.bcmap` are the official pdf.js CID CMap data files, required for text
extraction of PDFs that use predefined CID encodings (common in USPTO/EPO
filings). Without them `getTextContent()` returns no text and the viewer cannot
select/copy anything. Both Electron and the HTML shell serve these files
locally. Keep the parser, worker and CMaps on the same version when upgrading.
