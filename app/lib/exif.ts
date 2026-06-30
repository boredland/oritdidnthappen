// Minimal client-side EXIF reader: extracts the original capture time
// (DateTimeOriginal, tag 0x9003; falls back to DateTime 0x0132) from a JPEG's
// APP1/TIFF block. No dependency — we only need one timestamp, so we walk the
// markers directly instead of pulling in a full EXIF library.
//
// Returns unix seconds, or null when there's no usable EXIF (PNG/WebP/HEIC,
// screenshots, stripped metadata) — callers fall back to upload time.

const DATETIME_ORIGINAL = 0x9003;
const DATETIME = 0x0132;

export async function readTakenAt(file: File): Promise<number | null> {
  // Only JPEGs carry the APP1 EXIF block we parse here.
  if (file.type !== "image/jpeg") return null;
  try {
    // EXIF lives near the start; 128 KB is far more than enough.
    const head = await file.slice(0, 131072).arrayBuffer();
    const view = new DataView(head);
    if (view.getUint16(0) !== 0xffd8) return null; // not a JPEG (no SOI)

    let offset = 2;
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) break;
      const size = view.getUint16(offset + 2);
      if (marker === 0xffe1) {
        const exif = parseApp1(view, offset + 4, size - 2);
        if (exif != null) return exif;
      }
      // SOS — image data starts; no more metadata markers.
      if (marker === 0xffda) break;
      offset += 2 + size;
    }
  } catch {
    /* malformed header — treat as no EXIF */
  }
  return null;
}

function parseApp1(view: DataView, start: number, length: number): number | null {
  // "Exif\0\0"
  if (
    view.getUint32(start) !== 0x45786966 ||
    view.getUint16(start + 4) !== 0x0000
  ) {
    return null;
  }
  const tiff = start + 6;
  const le = view.getUint16(tiff) === 0x4949; // II = little-endian, MM = big
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);

  if (u16(tiff + 2) !== 0x002a) return null; // TIFF magic
  const ifd0 = tiff + u32(tiff + 4);

  const readDate = (valueOffset: number): number | null => {
    // EXIF datetime is an ASCII string "YYYY:MM:DD HH:MM:SS" (19 bytes).
    if (valueOffset < start || valueOffset + 19 > start + length) return null;
    let s = "";
    for (let i = 0; i < 19; i++) {
      const ch = view.getUint8(valueOffset + i);
      if (ch === 0) break;
      s += String.fromCharCode(ch);
    }
    const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    // EXIF times are local with no zone; treat as UTC for a stable sort key.
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  };

  // Walk an IFD's entries looking for the wanted tag; returns the value offset.
  const findTag = (ifd: number, tag: number): number | null => {
    if (ifd + 2 > start + length) return null;
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > start + length) return null; // entry runs past APP1
      if (u16(entry) === tag) return entry + 8; // value/offset field
    }
    return null;
  };

  // DateTimeOriginal lives in the EXIF sub-IFD (pointer tag 0x8769 in IFD0).
  const exifPtrEntry = findTag(ifd0, 0x8769);
  if (exifPtrEntry != null) {
    const exifIfd = tiff + u32(exifPtrEntry);
    const orig = findTag(exifIfd, DATETIME_ORIGINAL);
    if (orig != null) {
      const d = readDate(tiff + u32(orig));
      if (d != null) return d;
    }
  }
  // Fall back to IFD0 DateTime.
  const dt = findTag(ifd0, DATETIME);
  if (dt != null) return readDate(tiff + u32(dt));
  return null;
}
