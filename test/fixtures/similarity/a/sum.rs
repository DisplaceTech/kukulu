//! An additive checksum and a framing helper, version A.

use crate::rle::{decode, encode, DecodeError};

/// Starting value shared by every frame this crate writes.
pub const CHECKSUM_SEED: u32 = 0x5a;

/// Add every byte into a wrapping accumulator.
pub fn additive_sum(bytes: &[u8]) -> u32 {
    let mut accumulator = CHECKSUM_SEED;
    for &byte in bytes {
        accumulator = accumulator.wrapping_add(u32::from(byte));
    }
    accumulator
}

/// Prefix the coded bytes with the sum of the original bytes.
pub fn frame(original: &[u8]) -> Vec<u8> {
    let mut framed = additive_sum(original).to_le_bytes().to_vec();
    framed.extend(encode(original));
    framed
}

/// Check the prefix after decoding; returns None when it does not match.
pub fn unframe(framed: &[u8]) -> Result<Option<Vec<u8>>, DecodeError> {
    if framed.len() < 4 {
        return Err(DecodeError::Truncated);
    }
    let (head, body) = framed.split_at(4);
    let expected = u32::from_le_bytes([head[0], head[1], head[2], head[3]]);
    let restored = decode(body)?;
    if additive_sum(&restored) == expected {
        Ok(Some(restored))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_round_trip() {
        let data = b"zzzzyx";
        assert_eq!(unframe(&frame(data)).unwrap(), Some(data.to_vec()));
    }

    #[test]
    fn detects_damage() {
        let mut broken = frame(b"qqqq");
        broken[0] ^= 1;
        assert_eq!(unframe(&broken).unwrap(), None);
    }
}
