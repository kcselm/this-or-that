// Type sizing for matchup cards. Titles are free text and people write long
// ones ("Movie Title - a sentence about it"), so a fixed face either looks
// weedy for short entries or gets clipped for long ones. React Native's
// adjustsFontSizeToFit can't help: react-native-web ignores it outright and
// Android applies it inconsistently across multi-line text. So we measure
// here instead — estimate the wrapped line count at each face on a ladder and
// take the largest one whose block fits the card.

export type TitleParts = {
  /** The entry itself, e.g. a movie title. */
  name: string;
  /** Whatever the author appended after a spaced dash, or null. */
  note: string | null;
};

export type TextMetrics = {
  fontSize: number;
  lineHeight: number;
  maxLines: number;
};

export type TitleFit = {
  name: TextMetrics;
  note: TextMetrics | null;
  /** Vertical space between the name and the note block. */
  gap: number;
};

/** Faces to try, largest first; the top of the ladder is the h1 of the type scale. */
const SIZES = [28, 24, 22, 20, 18, 16, 15, 14, 13, 12];
/** Average glyph advance as a fraction of the font size, for a bold UI sans. */
const CHAR_RATIO = 0.55;
const LEADING = 1.25;
/** The note reads as secondary text at roughly two-thirds the name's size. */
const NOTE_RATIO = 0.68;
const NOTE_MIN = 11;
const GAP = 6;

const SEPARATOR = /\s+[-\u2013\u2014]\s+/;
/** A dash left dangling at either end, with no text on the far side. */
const DANGLING = /^[-\u2013\u2014]\s+|\s+[-\u2013\u2014]$/g;

const lineHeightFor = (fontSize: number) => Math.round(fontSize * LEADING);
const noteSizeFor = (fontSize: number) => Math.max(NOTE_MIN, Math.round(fontSize * NOTE_RATIO));

/**
 * Split "Name - some note" into its two halves. A bare hyphen inside a word
 * ("Spider-Man") is not a separator; only a dash with space on both sides is.
 */
export function splitTitle(raw: string): TitleParts {
  const text = raw.trim().replace(DANGLING, "").trim();
  const match = SEPARATOR.exec(text);
  if (!match) return { name: text, note: null };

  const name = text.slice(0, match.index).trim();
  const note = text.slice(match.index + match[0].length).trim();
  if (!name || !note) return { name: name || note, note: null };
  return { name, note };
}

/**
 * Estimated number of lines `text` occupies at `fontSize` in a box `width`
 * points wide. Greedy word wrap, with words wider than the line broken across
 * lines the way the platform's text engine would.
 */
export function wrapLines(text: string, width: number, fontSize: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;

  const perLine = Math.max(1, Math.floor(width / (fontSize * CHAR_RATIO)));
  let lines = 1;
  let used = 0;

  // Places a word at the start of the current line, spilling onto further
  // lines if it is too wide, and returns what it leaves on the last one.
  const place = (length: number) => {
    const overflow = Math.floor((length - 1) / perLine);
    lines += overflow;
    return length - overflow * perLine;
  };

  for (const word of words) {
    if (used === 0) {
      used = place(word.length);
    } else if (used + 1 + word.length <= perLine) {
      used += 1 + word.length;
    } else {
      lines += 1;
      used = place(word.length);
    }
  }
  return lines;
}

function metricsAt(text: string, width: number, fontSize: number): TextMetrics {
  return {
    fontSize,
    lineHeight: lineHeightFor(fontSize),
    maxLines: Math.max(1, wrapLines(text, width, fontSize)),
  };
}

function blockHeight(name: TextMetrics, note: TextMetrics | null): number {
  return name.maxLines * name.lineHeight + (note ? GAP + note.maxLines * note.lineHeight : 0);
}

/**
 * The largest face at which `raw` fits inside a `width` x `height` box. If
 * nothing on the ladder fits, the smallest face is used and lines are given
 * up — the note first, since the name is what identifies the entry.
 */
export function fitTitle(raw: string, width: number, height: number): TitleFit {
  const { name, note } = splitTitle(raw);

  // Before onLayout reports we have no box to fit; pick a middling face and
  // let the next render correct it.
  if (!(width > 0) || !(height > 0)) {
    return {
      name: { fontSize: 18, lineHeight: lineHeightFor(18), maxLines: 3 },
      note: note ? { fontSize: 13, lineHeight: lineHeightFor(13), maxLines: 3 } : null,
      gap: GAP,
    };
  }

  for (const size of SIZES) {
    const nameMetrics = metricsAt(name, width, size);
    const noteMetrics = note ? metricsAt(note, width, noteSizeFor(size)) : null;
    if (blockHeight(nameMetrics, noteMetrics) <= height) {
      return { name: nameMetrics, note: noteMetrics, gap: GAP };
    }
  }

  const smallest = SIZES[SIZES.length - 1];
  const nameMetrics = metricsAt(name, width, smallest);
  const noteMetrics = note ? metricsAt(note, width, noteSizeFor(smallest)) : null;
  while (blockHeight(nameMetrics, noteMetrics) > height) {
    if (noteMetrics && noteMetrics.maxLines > 1 && noteMetrics.maxLines >= nameMetrics.maxLines) {
      noteMetrics.maxLines -= 1;
    } else if (nameMetrics.maxLines > 1) {
      nameMetrics.maxLines -= 1;
    } else if (noteMetrics && noteMetrics.maxLines > 1) {
      noteMetrics.maxLines -= 1;
    } else {
      break; // One line each is the floor; the card clips from here.
    }
  }
  return { name: nameMetrics, note: noteMetrics, gap: GAP };
}
