//! A small checksum helper, written for the lexer tests.

use std::collections::HashMap;

/// A running total with a label.
pub struct Tally<'a> {
    label: &'a str,
    total: u32,
}

pub enum Step {
    Add(u32),
    Reset,
}

type Table = HashMap<u8, usize>;

/* A block comment /* with a nested one */ and more text */
impl<'a> Tally<'a> {
    pub fn new(label: &'a str) -> Tally<'a> {
        Tally { label, total: 0 }
    }

    fn apply(&mut self, step: Step) -> u32 {
        match step {
            Step::Add(n) => self.total += n,
            Step::Reset => self.total = 0,
        }
        self.total
    }
}

fn count(input: &[u8]) -> Table {
    let mut seen: Table = HashMap::new();
    let mask = 0xff_u8;
    let ratio: f64 = 1.5e3;
    let mut i = 0usize;
    loop {
        if i >= input.len() {
            break;
        }
        for _ in 0..2 {
            *seen.entry(input[i] & mask).or_insert(0) += 1;
        }
        i += 1;
        while i < 1_000 && ratio > 0.0 {
            i += 1;
            continue;
        }
    }
    seen
}

fn main() {
    let raw = r#"a "quoted" word"#;
    let bytes = b"abc";
    let newline = '\n';
    let letter = 'x';
    let mut tally = Tally::new("demo");
    let _ = tally.apply(Step::Add(3));
    println!("{} {} {:?} {} {}", raw, newline, bytes, letter, count(b"aab").len());
    return;
}
