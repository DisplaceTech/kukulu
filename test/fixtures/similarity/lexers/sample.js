// A tiny cart, written for the lexer tests.
'use strict';

/* A block comment. */
class Cart {
  constructor(tax = 0.2) {
    this.items = [];
    this.tax = tax;
  }

  add(name, price) {
    this.items.push({ name, price });
    return this;
  }
}

function total(cart) {
  let sum = 0;
  for (const item of cart.items) {
    if (item.price > 1e3) {
      continue;
    } else if (item.price === 0) {
      break;
    }
    sum += item.price * (1 + cart.tax);
  }
  return sum;
}

function label(kind) {
  switch (kind) {
    case 'a':
      return `item ${kind}`;
    default:
      return "other";
  }
}

const apply = (cart) => total(cart) > 0x10 ? label('a') : label("b");
do {
  var once = 1;
} while (false);
export async function later() {
  return await Promise.resolve(1);
}
