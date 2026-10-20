/* A tiny ring buffer, written for the lexer tests. */
#include <stddef.h>
#include <stdint.h>
#define CAPACITY 16
#define ADVANCE(i) \
    (((i) + 1) % CAPACITY)

typedef struct {
    uint8_t items[CAPACITY];
    size_t head;
    size_t tail;
} ring_t;

enum mode { MODE_FILL, MODE_DRAIN };

union word {
    uint32_t whole;
    uint8_t part[4];
};

// Push one byte; returns 0 when the buffer is full.
static int ring_push(ring_t *r, uint8_t value) {
    size_t next = ADVANCE(r->head);
    if (next == r->tail) {
        return 0;
    } else {
        r->items[r->head] = value;
        r->head = next;
    }
    return 1;
}

int classify(int c) {
    switch (c) {
    case 'a':
        return 1;
    case '\n':
        break;
    default:
        return 0;
    }
    return -1;
}

int main(void) {
    ring_t ring = { {0}, 0, 0 };
    unsigned long total = 0xFFul;
    double scale = 2.5e-1;
    int i;
    const char *name = "ring \"buffer\"";
    for (i = 0; i < 40; i++) {
        if (!ring_push(&ring, (uint8_t)i)) {
            continue;
        }
    }
    do {
        total >>= 1;
    } while (total > 0);
    while (scale > 1.0) {
        scale /= 2;
    }
    (void)name;
    return 0;
}
