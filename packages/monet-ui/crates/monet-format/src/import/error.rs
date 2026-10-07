// ─────────────────────────────────────────────────────────────
// Error type for the format readers. Hand-rolled (no thiserror) to keep the
// dependency surface at exactly one crate (miniz_oxide).
// ─────────────────────────────────────────────────────────────

use std::fmt;

/// Everything that can go wrong while sniffing or parsing a document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FormatError {
    /// Ran off the end of the buffer.
    Eof {
        needed: usize,
        offset: usize,
        len: usize,
    },
    /// The leading bytes don't match any format this crate understands.
    BadMagic,
    /// A field held a value this reader doesn't (yet) support.
    Unsupported(String),
    /// The bytes are internally inconsistent (bad length, stray pointer, …).
    Malformed(String),
    /// A compressed payload failed to inflate.
    Decompress(String),
}

impl fmt::Display for FormatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FormatError::Eof { needed, offset, len } => write!(
                f,
                "unexpected end of input: needed {needed} byte(s) at offset {offset}, buffer is {len}"
            ),
            FormatError::BadMagic => write!(f, "unrecognized file format (bad magic)"),
            FormatError::Unsupported(m) => write!(f, "unsupported: {m}"),
            FormatError::Malformed(m) => write!(f, "malformed document: {m}"),
            FormatError::Decompress(m) => write!(f, "decompression failed: {m}"),
        }
    }
}

impl std::error::Error for FormatError {}

pub type Result<T> = std::result::Result<T, FormatError>;
