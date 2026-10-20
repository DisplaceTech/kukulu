//! Packing and unpacking of repeated bytes (version B).

use std::fmt;

/// What can go wrong while unpacking.
#[derive(Debug)]
pub enum PackError {
    Dangling,
    EmptyRun,
}

impl fmt::Display for PackError {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PackError::Dangling => write!(out, "a count without a value"),
            PackError::EmptyRun => write!(out, "a run of length zero"),
        }
    }
}

/// One stretch of identical bytes.
#[derive(Clone, Copy)]
pub struct Stretch {
    pub width: u8,
    pub symbol: u8,
}

// Collect the stretches first, then flatten them in a second pass.
fn collect_stretches(source: &[u8]) -> Vec<Stretch> {
    let mut pieces_all: Vec<Stretch> = Vec::new();
    for &symbol in source {
        match pieces_all.last_mut() {
            Some(last) if last.symbol == symbol && last.width < 255 => last.width += 1,
            _ => pieces_all.push(Stretch { width: 1, symbol }),
        }
    }
    pieces_all
}

/// Reverse of `pack_bytes`, failing on malformed input.
pub fn unpack_bytes(packed: &[u8]) -> Result<Vec<u8>, PackError> {
    let mut restored_all = Vec::new();
    let mut walker_state = packed.iter();
    while let Some(&width) = walker_state.next() {
        let symbol = *walker_state.next().ok_or(PackError::Dangling)?;
        if width == 0 {
            return Err(PackError::EmptyRun);
        }
        restored_all.resize(restored_all.len() + width as usize, symbol);
    }
    Ok(restored_all)
}

/// Pack a slice into width/symbol pairs.
pub fn pack_bytes(source: &[u8]) -> Vec<u8> {
    collect_stretches(source)
        .iter()
        .flat_map(|stretch| [stretch.width, stretch.symbol])
        .collect()
}

#[cfg(test)]
mod checks {
    use super::*;

    #[test]
    fn symmetric() {
        let text = b"mmmnoppp";
        assert_eq!(unpack_bytes(&pack_bytes(text)).unwrap(), text.to_vec());
    }

    #[test]
    fn dangling_count() {
        assert!(unpack_bytes(&[4]).is_err());
    }
}
