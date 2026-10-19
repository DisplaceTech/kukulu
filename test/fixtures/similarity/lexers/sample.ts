// A tiny registry, written for the lexer tests.
interface Entry {
  id: number;
  label: string;
}

type Table = Record<string, Entry>;

enum Level {
  Low,
  High,
}

/* A block comment. */
class Registry {
  private table: Table = {};

  add(entry: Entry): boolean {
    if (entry.id < 0) {
      return false;
    }
    this.table[entry.label] = entry;
    return true;
  }

  find(label: string): Entry | undefined {
    return this.table[label];
  }
}

function level(n: number): Level {
  switch (n) {
    case 0:
      return Level.Low;
    default:
      break;
  }
  for (let i = 0; i < 2; i++) {
    if (i === 1) continue;
  }
  while (n > 0x10) {
    n -= 1;
  }
  return Level.High;
}

const note: string = `level ${level(3)}`;
const flag: boolean = true;
const anything: any = 'x';
