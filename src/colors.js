// Minimal ANSI styling, mirroring the sibling CLIs (leak-guard, cert-check,
// gitlab-sync): raw escapes, no dependency, gated by a single resolveUseColor.
// Help/banner output stays plain whenever color is off (NO_COLOR, non-TTY, or a
// piped stream), so captured/piped output is diff-stable and grep-able.
const RESET = "\x1b[0m";

const STYLE_CODES = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m"
};

// Explicit override wins, then NO_COLOR (off), then FORCE_COLOR (on), then the
// stream's TTY state. Same precedence the sibling CLIs use.
export function resolveUseColor(useColor, stream) {
  if (useColor !== undefined) {
    return useColor;
  }
  if (process.env.NO_COLOR) {
    return false;
  }
  if (process.env.FORCE_COLOR) {
    return true;
  }
  const target = stream ?? process.stdout;
  return Boolean(target && target.isTTY);
}

export function colorize(text, style, useColor) {
  return useColor && STYLE_CODES[style] ? `${STYLE_CODES[style]}${text}${RESET}` : text;
}

// Bold-cyan section header — the shared heading look across the CLI family.
export function heading(text, useColor) {
  return colorize(colorize(text, "cyan", useColor), "bold", useColor);
}
