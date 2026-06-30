/**
 * Background Fetch upload: when supported (Chromium/Android), hand a photo
 * batch to the browser's Background Fetch service so it keeps uploading even
 * if the user closes the PWA. iOS Safari and Firefox lack the API, so callers
 * MUST fall back to the in-page XHR pool when `supportsBackgroundUpload()` is
 * false. See https://developer.mozilla.org/en-US/docs/Web/API/BackgroundFetchManager
 *
 * The Background Fetch types are not in the standard DOM lib, so the minimal
 * surface we use is declared here.
 */

interface BackgroundFetchRecordProgress {
  uploaded: number;
  uploadTotal: number;
  downloaded: number;
  result: "" | "success" | "failure";
}

interface BackgroundFetchRegistration extends EventTarget {
  readonly id: string;
  readonly uploaded: number;
  readonly uploadTotal: number;
  addEventListener(
    type: "progress",
    listener: (this: BackgroundFetchRegistration) => void,
  ): void;
}

interface BackgroundFetchManager {
  fetch(
    id: string,
    requests: Request[] | string[],
    options?: {
      title?: string;
      icons?: { src: string; sizes?: string; type?: string; label?: string }[];
      downloadTotal?: number;
    },
  ): Promise<BackgroundFetchRegistration>;
}

type BgRegistration = ServiceWorkerRegistration & {
  backgroundFetch?: BackgroundFetchManager;
};

/** True when the platform can upload in the background and a SW is controlling. */
export function supportsBackgroundUpload(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "BackgroundFetchManager" in self &&
    navigator.serviceWorker.controller != null
  );
}

export interface BgUploadFile {
  file: File;
  takenAt: number | null;
}

export interface BgUploadHandle {
  id: string;
  /** Resolves when the whole batch leaves the page's control (browser owns it). */
  registration: BackgroundFetchRegistration;
}

/**
 * Build one POST Request per file (matching the in-page upload contract:
 * `file` + `takenAt` multipart fields, Bearer auth) and register them as a
 * single Background Fetch. Returns null if unsupported or registration fails,
 * so the caller can fall back without a throw.
 *
 * `onProgress` receives byte-weighted 0–100 for the whole batch while the page
 * is still open; once the page closes the service worker takes over silently.
 */
export async function startBackgroundUpload(
  code: string,
  sessionToken: string,
  files: BgUploadFile[],
  onProgress?: (percent: number) => void,
): Promise<BgUploadHandle | null> {
  if (!supportsBackgroundUpload() || files.length === 0) return null;

  const requests = files.map(({ file, takenAt }) => {
    const form = new FormData();
    form.append("file", file);
    form.append("takenAt", takenAt != null ? String(takenAt) : "");
    return new Request(`/api/upload/${code}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionToken}` },
      body: form,
    });
  });

  const uploadTotal = files.reduce((sum, f) => sum + f.file.size, 0);
  const id = `upload-${code}-${Date.now()}`;

  try {
    const reg = (await navigator.serviceWorker.ready) as BgRegistration;
    if (!reg.backgroundFetch) return null;
    const registration = await reg.backgroundFetch.fetch(id, requests, {
      title:
        files.length === 1
          ? "Uploading 1 photo"
          : `Uploading ${files.length} photos`,
      icons: [{ src: "/logo.svg", sizes: "72x72", type: "image/svg+xml" }],
      downloadTotal: uploadTotal,
    });

    if (onProgress) {
      registration.addEventListener("progress", function () {
        if (this.uploadTotal > 0) {
          onProgress(Math.round((this.uploaded / this.uploadTotal) * 100));
        }
      });
    }
    return { id, registration };
  } catch {
    // NotAllowedError / QuotaExceededError / duplicate id — fall back in-page.
    return null;
  }
}
