#ifndef RLE_H
#define RLE_H

#include <stddef.h>
#include <stdint.h>

size_t rle_encode(const uint8_t *in, size_t len, uint8_t *out);
size_t rle_decode(const uint8_t *in, size_t len, uint8_t *out);
uint32_t additive_checksum(const uint8_t *data, size_t len);
size_t frame_build(const uint8_t *in, size_t len, uint8_t *out);

#endif
