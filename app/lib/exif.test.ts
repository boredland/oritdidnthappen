import { describe, expect, it } from "vitest";
import { readTakenAt } from "./exif";

// --- Minimal JPEG+EXIF fixture builder -------------------------------------
// Assembles a real APP1/TIFF block so the parser is exercised against the
// byte layout it will see in the wild, not a mock. Big-endian (MM) TIFF.

const EXIF_DATETIME_ORIGINAL = 0x9003;
const EXIF_SUB_IFD_POINTER = 0x8769;
const TIFF_DATETIME = 0x0132;
const TYPE_ASCII = 2;
const TYPE_LONG = 4;

interface Entry {
  tag: number;
  type: number;
  count: number;
  value: number; // inline value or offset (from TIFF start)
}

function ifdBytes(
  entries: Entry[],
  nextIfdOffset: number,
): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(new ArrayBuffer(2 + entries.length * 12 + 4));
  const dv = new DataView(buf.buffer);
  dv.setUint16(0, entries.length, false);
  entries.forEach((e, i) => {
    const o = 2 + i * 12;
    dv.setUint16(o, e.tag, false);
    dv.setUint16(o + 2, e.type, false);
    dv.setUint32(o + 4, e.count, false);
    dv.setUint32(o + 8, e.value, false);
  });
  dv.setUint32(2 + entries.length * 12, nextIfdOffset, false);
  return buf;
}

// Builds a JPEG whose EXIF encodes `datetime` (an ASCII "YYYY:MM:DD HH:MM:SS")
// in either DateTimeOriginal (sub-IFD) or IFD0 DateTime.
function jpegWithDate(datetime: string, where: "original" | "ifd0"): File {
  const asciiSrc = new TextEncoder().encode(`${datetime}\0`); // 20 bytes
  const ascii = new Uint8Array(new ArrayBuffer(asciiSrc.length));
  ascii.set(asciiSrc);
  // TIFF layout (offsets from TIFF header start):
  //   0: header (8 bytes: "MM" + 0x002A + IFD0 offset)
  //   8: IFD0
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const tiffHeader = new Uint8Array(new ArrayBuffer(8));
  const hv = new DataView(tiffHeader.buffer);
  hv.setUint16(0, 0x4d4d, false); // "MM"
  hv.setUint16(2, 0x002a, false); // magic
  hv.setUint32(4, 8, false); // IFD0 at offset 8

  let ifd0: Uint8Array<ArrayBuffer>;
  let subIfd = new Uint8Array(new ArrayBuffer(0));
  let dateOffset: number;

  if (where === "ifd0") {
    // IFD0 with one DateTime entry pointing at the ASCII appended after it.
    const ifd0Size = 2 + 1 * 12 + 4;
    dateOffset = 8 + ifd0Size;
    ifd0 = ifdBytes(
      [{ tag: TIFF_DATETIME, type: TYPE_ASCII, count: 20, value: dateOffset }],
      0,
    );
  } else {
    // IFD0 has one entry: pointer to the EXIF sub-IFD.
    const ifd0Size = 2 + 1 * 12 + 4;
    const subIfdOffset = 8 + ifd0Size;
    const subIfdSize = 2 + 1 * 12 + 4;
    dateOffset = subIfdOffset + subIfdSize;
    ifd0 = ifdBytes(
      [
        {
          tag: EXIF_SUB_IFD_POINTER,
          type: TYPE_LONG,
          count: 1,
          value: subIfdOffset,
        },
      ],
      0,
    );
    subIfd = ifdBytes(
      [
        {
          tag: EXIF_DATETIME_ORIGINAL,
          type: TYPE_ASCII,
          count: 20,
          value: dateOffset,
        },
      ],
      0,
    );
  }

  parts.push(tiffHeader, ifd0, subIfd, ascii);
  const tiff = concat(parts);

  // APP1 payload = "Exif\0\0" + TIFF block.
  const exifId = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
  const app1Payload = concat([exifId, tiff]);
  const app1Len = app1Payload.length + 2; // includes the 2-byte length field

  const out: Uint8Array[] = [];
  out.push(new Uint8Array([0xff, 0xd8])); // SOI
  const marker = new Uint8Array(4);
  new DataView(marker.buffer).setUint16(0, 0xffe1, false); // APP1
  new DataView(marker.buffer).setUint16(2, app1Len, false);
  out.push(marker, app1Payload);
  out.push(new Uint8Array([0xff, 0xd9])); // EOI

  return new File([concat(out)], "photo.jpg", { type: "image/jpeg" });
}

function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new Uint8Array(new ArrayBuffer(total));
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.length;
  }
  return buf;
}

// UTC epoch seconds for a "YYYY:MM:DD HH:MM:SS" string (parser treats as UTC).
function utcSeconds(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
): number {
  return Math.floor(Date.UTC(y, mo - 1, d, h, mi, s) / 1000);
}

describe("readTakenAt", () => {
  it("returns null for a non-JPEG file without reading bytes", async () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "x.png", {
      type: "image/png",
    });
    expect(await readTakenAt(png)).toBeNull();
  });

  it("reads DateTimeOriginal from the EXIF sub-IFD", async () => {
    const file = jpegWithDate("2021:07:04 15:30:00", "original");
    expect(await readTakenAt(file)).toBe(utcSeconds(2021, 7, 4, 15, 30, 0));
  });

  it("falls back to IFD0 DateTime when no DateTimeOriginal exists", async () => {
    const file = jpegWithDate("2019:12:25 08:00:00", "ifd0");
    expect(await readTakenAt(file)).toBe(utcSeconds(2019, 12, 25, 8, 0, 0));
  });

  it("returns null for a JPEG with a valid SOI but no APP1/EXIF", async () => {
    const bare = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "b.jpg", {
      type: "image/jpeg",
    });
    expect(await readTakenAt(bare)).toBeNull();
  });

  it("returns null for a truncated/garbage JPEG body without throwing", async () => {
    const junk = new File(
      [new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x00, 0x00])],
      "j.jpg",
      { type: "image/jpeg" },
    );
    expect(await readTakenAt(junk)).toBeNull();
  });

  it("returns null when the datetime string is malformed", async () => {
    const file = jpegWithDate("not-a-real-date!!", "original");
    expect(await readTakenAt(file)).toBeNull();
  });
});
