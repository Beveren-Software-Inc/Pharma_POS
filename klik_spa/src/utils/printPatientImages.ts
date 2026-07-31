/**
 * Print one or more patient attachment images on a single page via a hidden iframe.
 * Mirrors healthcare's printImagesInPlace (CPR front + back stacked on one page).
 */
export function resolveAttachmentUrl(url?: string | null): string {
  if (!url?.trim()) return "";
  const trimmed = url.trim();
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:")
  ) {
    return trimmed;
  }
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}

export function printImagesInPlace(
  images: Array<{ url: string; label?: string }>,
  title = "Print"
): void {
  const resolved = images
    .map((img) => ({
      url: resolveAttachmentUrl(img.url),
      label: (img.label || "").replace(/[<>&"]/g, ""),
    }))
    .filter((img) => img.url);

  if (!resolved.length) return;

  const existing = document.getElementById("klik-pos-attach-print-frame");
  if (existing) existing.remove();

  const iframe = document.createElement("iframe");
  iframe.id = "klik-pos-attach-print-frame";
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }

  const safeTitle = title.replace(/[<>&"]/g, "");
  const multi = resolved.length > 1;
  const blocks = resolved
    .map((img, idx) => {
      const safeUrl = img.url.replace(/"/g, "&quot;");
      const caption = img.label ? `<div class="caption">${img.label}</div>` : "";
      return `<div class="block">${caption}<img class="print-img" data-idx="${idx}" src="${safeUrl}" alt="${img.label || safeTitle}" /></div>`;
    })
    .join("");

  doc.open();
  doc.write(`<!DOCTYPE html><html><head><title>${safeTitle}</title>
    <style>
      @page { margin: 8mm; size: auto; }
      html, body { margin: 0; padding: 0; background: #fff; }
      .page {
        display: flex;
        flex-direction: column;
        gap: ${multi ? "6mm" : "0"};
        min-height: 100vh;
        box-sizing: border-box;
        padding: 2mm;
      }
      .block {
        flex: ${multi ? "1 1 0" : "0 0 auto"};
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 0;
        page-break-inside: avoid;
      }
      .caption {
        font: 600 11px/1.3 system-ui, sans-serif;
        color: #334155;
        margin-bottom: 2mm;
        text-align: center;
      }
      img.print-img {
        max-width: 100%;
        max-height: ${multi ? "48vh" : "90vh"};
        width: auto;
        height: auto;
        object-fit: contain;
        display: block;
      }
    </style>
  </head><body><div class="page">${blocks}</div></body></html>`);
  doc.close();

  const cleanup = () => {
    try {
      iframe.remove();
    } catch {
      /* ignore */
    }
  };

  const runPrint = () => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    win.onafterprint = cleanup;
    setTimeout(cleanup, 60_000);
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
    }
  };

  const imgs = Array.from(doc.querySelectorAll("img.print-img")) as HTMLImageElement[];
  if (!imgs.length) {
    setTimeout(runPrint, 100);
    return;
  }

  let pending = imgs.length;
  const onReady = () => {
    pending -= 1;
    if (pending <= 0) setTimeout(runPrint, 50);
  };

  for (const img of imgs) {
    if (img.complete && img.naturalWidth > 0) {
      onReady();
    } else {
      img.onload = onReady;
      img.onerror = onReady;
    }
  }
}
