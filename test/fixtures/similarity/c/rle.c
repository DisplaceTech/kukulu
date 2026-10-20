/* Run-length coding with a checksum, version C. */
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#define CHECKSUM_SEED 0x5au

/* Write (count, byte) pairs into out; returns the number of bytes written. */
size_t rle_encode(const uint8_t *in, size_t len, uint8_t *out) {
    size_t written = 0;
    size_t i = 0;
    while (i < len) {
        uint8_t value = in[i];
        size_t run = 1;
        while (i + run < len && in[i + run] == value && run < 255) {
            run++;
        }
        out[written++] = (uint8_t)run;
        out[written++] = value;
        i += run;
    }
    return written;
}

/* Expand pairs back into bytes; returns 0 on malformed input. */
size_t rle_decode(const uint8_t *in, size_t len, uint8_t *out) {
    size_t produced = 0;
    if (len % 2 != 0) {
        return 0;
    }
    for (size_t i = 0; i < len; i += 2) {
        if (in[i] == 0) {
            return 0;
        }
        memset(out + produced, in[i + 1], in[i]);
        produced += in[i];
    }
    return produced;
}

uint32_t additive_checksum(const uint8_t *data, size_t len) {
    uint32_t total = CHECKSUM_SEED;
    for (size_t i = 0; i < len; i++) {
        total += data[i];
    }
    return total;
}

/* Frame: four little-endian bytes of checksum, then the coded payload. */
size_t frame_build(const uint8_t *in, size_t len, uint8_t *out) {
    uint32_t sum = additive_checksum(in, len);
    for (int k = 0; k < 4; k++) {
        out[k] = (uint8_t)(sum >> (8 * k));
    }
    return 4 + rle_encode(in, len, out + 4);
}
