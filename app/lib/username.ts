const ADJECTIVES = [
  "quiet",
  "calm",
  "bright",
  "gentle",
  "swift",
  "bold",
  "wise",
  "merry",
  "noble",
  "warm",
  "amber",
  "ivory",
  "velvet",
  "golden",
  "silver",
  "dusky",
  "misty",
  "sunny",
  "lively",
  "graceful",
  "humble",
  "clever",
  "cosmic",
  "dapper",
  "earnest",
  "fabled",
  "honest",
  "jolly",
  "keen",
  "lucky",
  "mellow",
  "nimble",
  "opal",
  "plucky",
  "regal",
  "serene",
  "tender",
  "upbeat",
  "vivid",
  "witty",
  "zesty",
  "azure",
  "crimson",
  "emerald",
  "hazel",
  "indigo",
  "jade",
  "saffron",
  "topaz",
];

const ANIMALS = [
  "otter",
  "heron",
  "fox",
  "lynx",
  "robin",
  "sparrow",
  "finch",
  "wren",
  "marten",
  "stoat",
  "hare",
  "deer",
  "badger",
  "owl",
  "raven",
  "magpie",
  "swift",
  "swallow",
  "kestrel",
  "falcon",
  "ibis",
  "egret",
  "crane",
  "plover",
  "puffin",
  "seal",
  "dolphin",
  "marlin",
  "perch",
  "tench",
  "carp",
  "pike",
  "beetle",
  "cricket",
  "firefly",
  "moth",
  "bee",
  "hawk",
  "eagle",
  "gull",
  "tern",
  "petrel",
  "quail",
  "snipe",
  "thrush",
  "linnet",
  "siskin",
  "vole",
  "marmot",
  "pika",
];

function pick<T>(arr: T[]): T {
  const i = crypto.getRandomValues(new Uint32Array(1))[0] % arr.length;
  return arr[i];
}

/** A single random `adjective-animal` candidate. Not collision-checked. */
export function randomUsername(): string {
  return `${pick(ADJECTIVES)}-${pick(ANIMALS)}`;
}

/**
 * Produce a username unique within an event. Tries random combos, then falls
 * back to a numeric suffix once the keyspace is saturated for that event.
 */
export async function uniqueUsername(
  isTaken: (name: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = randomUsername();
    if (!(await isTaken(candidate))) return candidate;
  }
  for (let n = 0; n < 1000; n++) {
    const suffix = crypto.getRandomValues(new Uint32Array(1))[0] % 100;
    const candidate = `${randomUsername()}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  return `${randomUsername()}-${Date.now().toString(36)}`;
}

export function sanitizeUsername(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(trimmed)) return null;
  return trimmed;
}
