export const BLOCKS = [
  {
    id: "base",
    label: "Base 00-FF",
    file: "./data/base.json",
    expectedEntries: 256,
    complete: true,
    note: "Taula principal completa de bytes base 00-FF.",
    description:
      "Aquesta és la taula base del Z80: les instruccions normals d'un sol byte inicial, sense prefixos especials. Aquí hi trobaràs càrregues, salts, ALU, pila, control i també els bytes que actuen com a prefix per obrir altres subtaules."
  },
  {
    id: "cb",
    label: "CB",
    file: "./data/cb.json",
    expectedEntries: 256,
    complete: true,
    note: "Taula completa de la subtaula CB, amb posicions no documentades marcades com a tal.",
    description:
      "La subtaula CB agrupa operacions de bits: rotacions, desplaçaments i instruccions BIT/RES/SET. És útil quan vols provar, activar, esborrar o moure bits dins de registres o dins de la memòria apuntada per HL."
  },
  {
    id: "ed",
    label: "ED",
    file: "./data/ed.json",
    expectedEntries: 256,
    complete: true,
    note: "Taula completa de la subtaula ED, amb posicions sense instrucció documentada marcades explícitament.",
    description:
      "La subtaula ED conté instruccions ampliades del Z80, com còpia de blocs, entrada/sortida, alguns accessos de 16 bits i modes d'interrupció. És una zona més especialitzada, menys freqüent que la base, però molt important per entendre rutines de sistema."
  },
  {
    id: "dd",
    label: "DD",
    file: "./data/dd.json",
    expectedEntries: 256,
    complete: true,
    note: "Taula completa del prefix DD, amb instruccions documentades sobre IX i posicions no documentades diferenciades.",
    description:
      "La subtaula DD reaprofita moltes instruccions de la base, però fent servir el registre IX en lloc d'HL. Serveix per treballar amb estructures de dades o camps a memòria usant offsets respecte a IX."
  },
  {
    id: "fd",
    label: "FD",
    file: "./data/fd.json",
    expectedEntries: 256,
    complete: true,
    note: "Taula completa del prefix FD, amb instruccions documentades sobre IY i posicions no documentades diferenciades.",
    description:
      "La subtaula FD és l'equivalent de DD però amb el registre IY. Normalment s'utilitza quan vols un segon registre indexat, separat d'IX, per portar una altra estructura, context o taula."
  },
  {
    id: "ddcb",
    label: "DD CB d xx",
    file: "./data/ddcb.json",
    expectedEntries: 256,
    complete: true,
    note: "Taula completa de DD CB d xx, amb les formes documentades sobre (IX+d) i la resta marcades com a no documentades.",
    description:
      "La subtaula DD CB d xx aplica operacions de bits sobre la memòria situada a IX més un desplaçament signat d. És la combinació que fas servir quan vols tocar bits d'un camp concret dins una estructura indexada."
  },
  {
    id: "fdcb",
    label: "FD CB d xx",
    file: "./data/fdcb.json",
    expectedEntries: 256,
    complete: true,
    note: "Taula completa de FD CB d xx, amb les formes documentades sobre (IY+d) i la resta marcades com a no documentades.",
    description:
      "La subtaula FD CB d xx és la mateixa idea que DD CB, però treballant sobre IY+d. Va bé quan IY apunta a una altra estructura i necessites provar o modificar bits directament a memòria."
  }
];

const dataCache = new Map();
const REQUIRED_ENTRY_FIELDS = ["id", "group", "row", "col", "opcode", "mnemonic", "clck", "siz", "description", "category", "flags"];

export function getBlockDefinition(blockId) {
  return BLOCKS.find((block) => block.id === blockId) ?? BLOCKS[0];
}

export async function loadBlockData(blockId) {
  if (dataCache.has(blockId)) {
    return dataCache.get(blockId);
  }

  const block = getBlockDefinition(blockId);

  try {
    const response = await fetch(block.file);
    if (!response.ok) {
      throw new Error(`No s'ha pogut carregar ${block.file} (${response.status}).`);
    }

    const entries = await response.json();
    validateEntries(entries, block);
    dataCache.set(blockId, entries);
    return entries;
  } catch (error) {
    if (window.location.protocol === "file:") {
      throw new Error(
        "El navegador ha blocat la lectura de JSON amb file://. Obre aquesta carpeta amb un petit servidor estatic, per exemple: python3 -m http.server 8000"
      );
    }

    throw error;
  }
}

export function normalizeText(value) {
  return (value ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function getEntryDescription(entry, locale = "ca") {
  if (entry?.descriptionByLocale?.[locale]) {
    return entry.descriptionByLocale[locale];
  }

  return entry?.description ?? "";
}

export function getEntryExample(entry, locale = "ca") {
  if (entry?.exampleByLocale?.[locale]) {
    return entry.exampleByLocale[locale];
  }

  return entry?.example ?? "";
}

export function getUniqueCategories(entries) {
  return [...new Set(entries.map((entry) => entry.category).filter(Boolean))].sort();
}

export function buildCellMap(entries) {
  return new Map(entries.map((entry) => [`${entry.row}:${entry.col}`.toUpperCase(), entry]));
}

export function buildRows() {
  return "0123456789ABCDEF".split("").map((value) => `${value}x`);
}

export function buildCols() {
  return "0123456789ABCDEF".split("");
}

export function matchesFilters(entry, filters, locale = "ca") {
  const { query, category } = filters;

  if (category !== "all" && entry.category !== category) {
    return false;
  }

  if (!query) {
    return true;
  }

  const haystack = [
    entry.mnemonic,
    entry.opcode,
    entry.id,
    getEntryDescription(entry, locale)
  ]
    .map(normalizeText)
    .join(" ");

  return haystack.includes(normalizeText(query));
}

export function formatCount({ matches, total, expectedEntries = total, documented, filteredDocumented }) {
  const filteredLabel = matches === 1 ? "coincideix" : "coincideixen";

  if (matches === total) {
    return `${total} de ${expectedEntries} posicions carregades. ${documented} instruccions documentades i ${total - documented} posicions no documentades o reservades`;
  }

  return `${matches} de ${total} ${filteredLabel} amb el filtre actual. En aquest resultat hi ha ${filteredDocumented} instruccions documentades`;
}

export function categoryLabel(category) {
  return {
    load: "load / ld",
    alu: "alu",
    jump: "jump",
    stack: "stack",
    bit: "bit",
    control: "control",
    exchange: "exchange",
    io: "io",
    prefix: "prefix",
    undocumented: "no documentada"
  }[category] ?? category;
}

function validateEntries(entries, block) {
  if (!Array.isArray(entries)) {
    throw new Error(`El fitxer del bloc ${block.label} no conté un array d'entrades.`);
  }

  for (const [index, entry] of entries.entries()) {
    for (const field of REQUIRED_ENTRY_FIELDS) {
      if (!(field in entry)) {
        throw new Error(`Falta el camp obligatori "${field}" a l'entrada ${index} del bloc ${block.label}.`);
      }
    }

    if (!Array.isArray(entry.flags?.affected) || typeof entry.flags?.notes !== "string") {
      throw new Error(`El camp "flags" de l'entrada ${entry.id ?? index} del bloc ${block.label} no té l'estructura esperada.`);
    }
  }
}
