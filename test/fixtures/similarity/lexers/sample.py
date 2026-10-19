"""A tiny word counter, written for the lexer tests."""
import re
from collections import Counter

# Count the words in a text.
class WordCount:
    """Keeps a running count."""

    def __init__(self, text: str, limit: int = 0x10) -> None:
        self.text = text
        self.limit = limit

    def top(self) -> list:
        words = re.findall(r"[a-z]+", self.text.lower())
        counts = Counter(words)
        return [w for w, _ in counts.most_common(self.limit)]


def classify(n: int) -> str:
    if n > 1_000:
        return 'big'
    elif n == 0:
        return "zero"
    else:
        for i in range(3):
            if i == 1:
                continue
            while n > 100.5e0:
                n -= 1
                break
        return f"small {n}"


async_total = 0
raw = r"C:\temp\file"
note = '''a
multi-line string'''
try:
    total = WordCount("a b a").top()
except ValueError as err:
    raise
finally:
    pass
