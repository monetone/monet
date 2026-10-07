// ─── icons ─────────────────────────────────────────────────────
// Geometric monoline glyphs at 16px. Original — no Adobe-style icons.
export const Icon = ({ d, size = 16, fill, strokeWidth = 1.5 }: { d: string; size?: number; fill?: boolean; strokeWidth?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
       stroke="currentColor" strokeWidth={strokeWidth}
       strokeLinecap="round" strokeLinejoin="round">
    {fill ? <path d={d} fill="currentColor" stroke="none"/> : <path d={d}/>}
  </svg>
);

export const I = {
  // tool icons
  cursor:    "M3 2L13 8L8.5 9L11 13L9 14L7 10L3 13Z",
  brush:     "M3 13C3 11 5 9 7 9L11 5C12 4 13 5 12 6L8 10C8 12 6 14 4 14L3 13Z",
  erase:     "M5 11L11 5L13 7L7 13L4 13L3 12Z M10 6L12 8",
  pen:       "M2 14L4 12L11 5L13 7L6 14L2 14ZM10 6L12 8",
  shape:     "M3 4C3 3 4 2 5 2L11 2C12 2 13 3 13 4L13 12C13 13 12 14 11 14L5 14C4 14 3 13 3 12Z",
  text:      "M3 4L13 4M8 4L8 13",
  gradient:  "M3 4L13 4L13 12L3 12Z",
  hand:      "M5 8V4C5 3 6 3 6 4V7M6 7V3C6 2 7 2 7 3V7M7 7V3C7 2 8 2 8 3V7M8 7V4C8 3 9 3 9 4V8C9 12 7 14 5 14C3 14 2 13 2 11C2 10 3 9 5 9",
  zoom:      "M7 11A4 4 0 1 0 7 3A4 4 0 0 0 7 11ZM10 10L13 13M5 7H9M7 5V9",
  marquee:   "M3 4L3 4M3 6L3 8M3 10L3 12L4 12M6 12L8 12M10 12L12 12L12 11M12 9L12 7M12 5L12 4L11 4M9 4L7 4M5 4L4 4M3 4L4 4",
  crop:      "M5 1L5 11L15 11M11 15L11 5L1 5",
  lasso:     "M3 6C3 4 5 3 7 3C10 3 13 5 13 8C13 10 11 12 9 12L8 14M7 12L5 14",
  clone:     "M5 5A2 2 0 0 1 7 3L11 3A2 2 0 0 1 13 5L13 9A2 2 0 0 1 11 11L9 11M3 7L3 11A2 2 0 0 0 5 13L9 13A2 2 0 0 0 11 11",
  blur:      "M8 2C5 5 3 7 3 9.5C3 12 5 14 8 14C11 14 13 12 13 9.5C13 7 11 5 8 2Z",
  dropper:   "M3 13L7 9M11 5L9 7L11 9L13 7L11 5ZM7 9L11 5L13 3L13 5",
  // controls
  chevDown:  "M4 6L8 10L12 6",
  chevRight: "M6 4L10 8L6 12",
  chevLeft:  "M10 4L6 8L10 12",
  close:     "M4 4L12 12M12 4L4 12",
  more:      "M3 8H4M8 8H9M13 8H14",
  plus:      "M8 3L8 13M3 8L13 8",
  minus:     "M3 8L13 8",
  search:    "M7 2A5 5 0 1 0 7 12A5 5 0 0 0 7 2M11 11L14 14",
  pin:       "M8 2L11 5L11 9L13 11L9 11L9 14L7 14L7 11L3 11L5 9L5 5Z",
  expand:    "M3 6L3 3L6 3M13 6L13 3L10 3M3 10L3 13L6 13M13 10L13 13L10 13",
  fit:       "M3 6L3 3L6 3M13 6L13 3L10 3M3 10L3 13L6 13M13 10L13 13L10 13M6 6L10 6L10 10L6 10Z",
  // layer panel
  eye:       "M1.5 8C3 5 5 3.5 8 3.5C11 3.5 13 5 14.5 8C13 11 11 12.5 8 12.5C5 12.5 3 11 1.5 8ZM8 6A2 2 0 1 0 8 10A2 2 0 0 0 8 6Z",
  lock:      "M5 7L5 5A3 3 0 0 1 11 5L11 7M4 7L12 7L12 13L4 13Z",
  link:      "M6 8H10M7 5L7 4A3 3 0 1 1 7 10L7 11M9 11L9 12A3 3 0 1 0 9 6L9 5",
  // audio
  play:      "M5 3L13 8L5 13Z",
  pause:     "M5 3L7 3L7 13L5 13ZM9 3L11 3L11 13L9 13Z",
  stop:      "M4 4L12 4L12 12L4 12Z",
  rewind:    "M3 4L3 12M5 8L13 4L13 12Z",
  // video
  cut:       "M4 4L12 12M12 4L4 12M5 5A1 1 0 1 1 3 5A1 1 0 0 1 5 5ZM5 11A1 1 0 1 1 3 11A1 1 0 0 1 5 11",
  marker:    "M8 2L12 6L8 14L4 6Z",
  // transport
  loop:      "M4 6L11 6A2.5 2.5 0 0 1 11 11L5 11M4 6L6 4M4 6L6 8M12 10L10 12M12 10L10 8",
  record:    "M8 4A4 4 0 1 1 8 12A4 4 0 0 1 8 4Z",
};
