//! Run-length coding of byte slices, version A.

/// Failure modes when reading a coded stream.
#[derive(Debug, PartialEq)]
pub enum DecodeError {
    Truncated,
    ZeroRun,
}

/// Walks a slice and yields (count, byte) runs.
pub struct RunIter<'a> {
    rest: &'a [u8],
}

impl<'a> RunIter<'a> {
    pub fn new(rest: &'a [u8]) -> RunIter<'a> {
        RunIter { rest }
    }
}

impl<'a> Iterator for RunIter<'a> {
    type Item = (u8, u8);

    fn next(&mut self) -> Option<(u8, u8)> {
        let first = *self.rest.first()?;
        let mut length = 1usize;
        while length < 255 && length < self.rest.len() && self.rest[length] == first {
            length += 1;
        }
        self.rest = &self.rest[length..];
        Some((length as u8, first))
    }
}

/// Encode by pulling runs off the iterator one at a time.
pub fn encode(input: &[u8]) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(input.len());
    for (count, value) in RunIter::new(input) {
        encoded.push(count);
        encoded.push(value);
    }
    encoded
}

/// Decode pairs back into bytes; odd lengths and zero counts are errors.
pub fn decode(data: &[u8]) -> Result<Vec<u8>, DecodeError> {
    if data.len() % 2 != 0 {
        return Err(DecodeError::Truncated);
    }
    let mut decoded = Vec::new();
    for pair in data.chunks(2) {
        if pair[0] == 0 {
            return Err(DecodeError::ZeroRun);
        }
        decoded.extend(std::iter::repeat(pair[1]).take(pair[0] as usize));
    }
    Ok(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let sample = b"aaabccdddd";
        assert_eq!(decode(&encode(sample)).unwrap(), sample.to_vec());
    }

    #[test]
    fn rejects_odd_input() {
        assert_eq!(decode(&[3]), Err(DecodeError::Truncated));
    }
}
