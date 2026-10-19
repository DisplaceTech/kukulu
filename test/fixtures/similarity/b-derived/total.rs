//! Folding totals and wrapping packed data in a frame (version B).

use crate::pack::{pack_bytes, unpack_bytes, PackError};

/// Seed used by every frame this crate writes.
pub const CHECKSUM_SEED: u32 = 0x5a;

// Fold all bytes into one number, starting from the seed.
pub fn fold_total(data: &[u8]) -> u32 {
    data.iter()
        .fold(CHECKSUM_SEED, |carry_value, &item| carry_value.wrapping_add(item as u32))
}

/// Open a frame, comparing the stored total with a fresh one.
pub fn open_frame(frame: &[u8]) -> Result<Vec<u8>, PackError> {
    if frame.len() < 4 {
        return Err(PackError::Dangling);
    }
    let recorded_sum = u32::from_le_bytes(frame[..4].try_into().unwrap());
    let inner = unpack_bytes(&frame[4..])?;
    if fold_total(&inner) != recorded_sum {
        return Err(PackError::EmptyRun);
    }
    Ok(inner)
}

/// Build a frame: four bytes of total, then the packed payload.
pub fn wrap_frame(payload: &[u8]) -> Vec<u8> {
    let mut result_bytes = Vec::new();
    result_bytes.extend_from_slice(&fold_total(payload).to_le_bytes());
    result_bytes.extend(pack_bytes(payload));
    result_bytes
}

#[cfg(test)]
mod checks {
    use super::*;

    #[test]
    fn frames_open() {
        let blob = b"uuuuvw";
        assert_eq!(open_frame(&wrap_frame(blob)).unwrap(), blob.to_vec());
    }

    #[test]
    fn totals_wrap() {
        assert_eq!(fold_total(&[]), CHECKSUM_SEED);
    }
}
