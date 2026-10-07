// ─────────────────────────────────────────────────────────────
// Big-endian byte cursor shared by the PSD/PSB and XCF readers.
//
// Both formats are big-endian throughout and both seek by absolute offset
// (XCF pointers; PSD sub-section bounds). One cursor with seek covers both.
// `read_ptr(wide)` reads a 4- or 8-byte pointer (PSB / XCF v11 widen these).
// `little_endian` flips it for a layered TIFF's little-endian ImageSourceData,
// which writes every integer, and every 4-character code, byte-reversed.
// ─────────────────────────────────────────────────────────────

use crate::import::error::{FormatError, Result};

pub struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
    le: bool,
}

impl<'a> Reader<'a> {
    pub fn new(buf: &'a [u8]) -> Reader<'a> {
        Reader { buf, pos: 0, le: false }
    }

    /// Read integers and 4-character codes in little-endian order instead.
    pub fn little_endian(mut self, le: bool) -> Reader<'a> {
        self.le = le;
        self
    }
    #[inline]
    pub fn is_little_endian(&self) -> bool {
        self.le
    }

    #[inline]
    pub fn position(&self) -> usize {
        self.pos
    }
    #[inline]
    pub fn len(&self) -> usize {
        self.buf.len()
    }
    #[inline]
    pub fn remaining(&self) -> usize {
        self.buf.len().saturating_sub(self.pos)
    }
    /// Absolute seek. Permitted to land exactly at end-of-buffer (== len).
    pub fn seek(&mut self, pos: usize) -> Result<()> {
        if pos > self.buf.len() {
            return Err(FormatError::Eof {
                needed: pos - self.buf.len(),
                offset: pos,
                len: self.buf.len(),
            });
        }
        self.pos = pos;
        Ok(())
    }

    pub fn skip(&mut self, n: usize) -> Result<()> {
        let target = self
            .pos
            .checked_add(n)
            .ok_or(FormatError::Malformed("skip overflow".into()))?;
        self.seek(target)
    }

    fn ensure(&self, n: usize) -> Result<()> {
        if self.remaining() < n {
            return Err(FormatError::Eof {
                needed: n,
                offset: self.pos,
                len: self.buf.len(),
            });
        }
        Ok(())
    }

    pub fn read_bytes(&mut self, n: usize) -> Result<&'a [u8]> {
        self.ensure(n)?;
        let s = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }

    pub fn read_vec(&mut self, n: usize) -> Result<Vec<u8>> {
        Ok(self.read_bytes(n)?.to_vec())
    }

    /// The unread tail of the buffer (for length-unknown zlib tile inflate).
    pub fn rest(&self) -> &'a [u8] {
        &self.buf[self.pos..]
    }

    /// Peek the next 4 bytes as a signature without advancing. None at EOF.
    pub fn peek4(&self) -> Option<[u8; 4]> {
        if self.remaining() < 4 {
            return None;
        }
        let mut b = [
            self.buf[self.pos],
            self.buf[self.pos + 1],
            self.buf[self.pos + 2],
            self.buf[self.pos + 3],
        ];
        if self.le {
            b.reverse();
        }
        Some(b)
    }

    pub fn u8(&mut self) -> Result<u8> {
        self.ensure(1)?;
        let v = self.buf[self.pos];
        self.pos += 1;
        Ok(v)
    }
    pub fn u16(&mut self) -> Result<u16> {
        let b: [u8; 2] = self.read_bytes(2)?.try_into().unwrap();
        Ok(if self.le { u16::from_le_bytes(b) } else { u16::from_be_bytes(b) })
    }
    pub fn i16(&mut self) -> Result<i16> {
        Ok(self.u16()? as i16)
    }
    pub fn u32(&mut self) -> Result<u32> {
        let b: [u8; 4] = self.read_bytes(4)?.try_into().unwrap();
        Ok(if self.le { u32::from_le_bytes(b) } else { u32::from_be_bytes(b) })
    }
    pub fn i32(&mut self) -> Result<i32> {
        Ok(self.u32()? as i32)
    }
    pub fn u64(&mut self) -> Result<u64> {
        let b: [u8; 8] = self.read_bytes(8)?.try_into().unwrap();
        Ok(if self.le { u64::from_le_bytes(b) } else { u64::from_be_bytes(b) })
    }
    pub fn f32(&mut self) -> Result<f32> {
        Ok(f32::from_bits(self.u32()?))
    }
    pub fn f64(&mut self) -> Result<f64> {
        Ok(f64::from_bits(self.u64()?))
    }

    /// A 4-character signature/key (`8BIM`, `norm`, `DrSh`, …).
    pub fn fourcc(&mut self) -> Result<[u8; 4]> {
        let mut b: [u8; 4] = self.read_bytes(4)?.try_into().unwrap();
        if self.le {
            b.reverse();
        }
        Ok(b)
    }

    /// A pointer/offset: 4 bytes normally, 8 bytes when `wide` (PSB length
    /// fields / XCF v11). Returned as u64 so callers seek uniformly.
    pub fn read_ptr(&mut self, wide: bool) -> Result<u64> {
        if wide {
            self.u64()
        } else {
            Ok(self.u32()? as u64)
        }
    }

    /// PSD Pascal string: 1 length byte + bytes, padded so the whole field
    /// (length byte included) is a multiple of `pad`.
    pub fn pascal_string(&mut self, pad: usize) -> Result<String> {
        let n = self.u8()? as usize;
        let bytes = self.read_vec(n)?;
        let consumed = 1 + n;
        let rem = consumed % pad;
        if rem != 0 {
            self.skip(pad - rem)?;
        }
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// PSD Unicode string (used by `luni`, descriptor `TEXT`): u32 count of
    /// UTF-16 code units, then count*2 BE bytes. A trailing NUL unit is common
    /// and trimmed. `pad` rounds the whole field up (luni pads to 4; pass 1 for
    /// no padding, as inside descriptors).
    pub fn unicode_string(&mut self, pad: usize) -> Result<String> {
        let count = self.u32()? as usize;
        let byte_len = count
            .checked_mul(2)
            .ok_or_else(|| FormatError::Malformed("Unicode string length overflow".into()))?;
        // Validate the declared byte span before reserving `count` UTF-16
        // units. A four-byte hostile input must not turn into a multi-gigabyte
        // allocation attempt.
        self.ensure(byte_len)?;
        let mut units = Vec::with_capacity(count);
        for _ in 0..count {
            units.push(self.u16()?);
        }
        // Drop a single trailing NUL terminator if present.
        if units.last() == Some(&0) {
            units.pop();
        }
        if pad > 1 {
            let consumed = 4usize
                .checked_add(byte_len)
                .ok_or_else(|| FormatError::Malformed("Unicode string length overflow".into()))?;
            let rem = consumed % pad;
            if rem != 0 {
                self.skip(pad - rem)?;
            }
        }
        Ok(String::from_utf16_lossy(&units))
    }

    /// XCF string: u32 length (INCLUDING the trailing NUL), then that many
    /// UTF-8 bytes. `length == 0` is the empty string.
    pub fn xcf_string(&mut self) -> Result<String> {
        let len = self.u32()? as usize;
        if len == 0 {
            return Ok(String::new());
        }
        let mut bytes = self.read_vec(len)?;
        if bytes.last() == Some(&0) {
            bytes.pop();
        }
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn be_reads_and_seek() {
        let data = [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07];
        let mut r = Reader::new(&data);
        assert_eq!(r.u16().unwrap(), 0x0001);
        assert_eq!(r.u32().unwrap(), 0x02030405);
        assert_eq!(r.position(), 6);
        r.seek(0).unwrap();
        assert_eq!(r.u64().unwrap(), 0x0001020304050607);
        assert!(r.u8().is_err()); // EOF
    }

    #[test]
    fn pointer_width() {
        let data = [0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x00];
        let mut r = Reader::new(&data);
        assert_eq!(r.read_ptr(false).unwrap(), 9);
        r.seek(0).unwrap();
        assert_eq!(r.read_ptr(true).unwrap(), 0x0000000900000000);
    }

    #[test]
    fn pascal_padding() {
        // length byte = 2, "ab", padded to multiple of 4 => 1 pad byte. Next u8 = 0xFF.
        let data = [0x02, b'a', b'b', 0x00, 0xFF];
        let mut r = Reader::new(&data);
        assert_eq!(r.pascal_string(4).unwrap(), "ab");
        assert_eq!(r.position(), 4);
        assert_eq!(r.u8().unwrap(), 0xFF);
    }

    #[test]
    fn xcf_string_strips_nul() {
        let data = [0x00, 0x00, 0x00, 0x03, b'h', b'i', 0x00];
        let mut r = Reader::new(&data);
        assert_eq!(r.xcf_string().unwrap(), "hi");
        assert_eq!(r.position(), 7);
    }

    #[test]
    fn unicode_count_is_checked_before_allocation() {
        let bytes = u32::MAX.to_be_bytes();
        let mut r = Reader::new(&bytes);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            r.unicode_string(1)
        }));
        assert!(result.expect("Unicode length check must not panic").is_err());
    }
}
