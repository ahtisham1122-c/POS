const assert = require('node:assert/strict');

const {
  calculateDiscount,
  calculateItemDiscount,
  calculateTax,
  resolveSaleUnitPrice,
  roundMoney
} = require('../dist-electron/lib/salesMath.js');

function money(value) {
  return roundMoney(value);
}

assert.equal(resolveSaleUnitPrice({ code: 'MILK', name: 'Fresh Milk', selling_price: 0 }, { milk_rate: 220 }), 220);
assert.equal(resolveSaleUnitPrice({ code: 'YOGT', name: 'Fresh Yogurt', selling_price: 0 }, { yogurt_rate: 260 }), 260);
assert.equal(resolveSaleUnitPrice({ code: 'BRED', name: 'Bread', selling_price: 120 }, {}), 120);
assert.equal(resolveSaleUnitPrice({ code: 'MLKP', name: 'Milk Powder', selling_price: 950 }, { milk_rate: 220 }), 950);
assert.equal(resolveSaleUnitPrice({ code: 'YOGDR', name: 'Yogurt Drink', selling_price: 140 }, { yogurt_rate: 260 }), 140);

assert.deepEqual(calculateItemDiscount(1000, 'PERCENT', 10), {
  discountType: 'PERCENT',
  discountValue: 10,
  discountAmount: 100
});
assert.deepEqual(calculateItemDiscount(1000, 'RS', 75), {
  discountType: 'RS',
  discountValue: 75,
  discountAmount: 75
});
assert.throws(() => calculateItemDiscount(100, 'RS', 101), /greater than the item total/);

assert.deepEqual(calculateDiscount(1000, 'PERCENT', 12.5), {
  discountType: 'PERCENT',
  discountValue: 12.5,
  discountAmount: 125
});
assert.deepEqual(calculateDiscount(1000, 'RS', 80), {
  discountType: 'RS',
  discountValue: 80,
  discountAmount: 80
});
assert.throws(() => calculateDiscount(100, 'PERCENT', 101), /more than 100/);

const subtotal = money(2 * 220 + 1 * 120);
const billDiscount = calculateDiscount(subtotal, 'RS', 60);
const tax = calculateTax({
  subtotal,
  taxableSubtotal: 120,
  discountAmount: billDiscount.discountAmount,
  taxEnabled: true,
  taxRate: 15
});

assert.equal(subtotal, 560);
assert.equal(billDiscount.discountAmount, 60);
assert.equal(tax.taxableAmount, 107.14);
assert.equal(tax.taxAmount, 16.07);
assert.equal(money(subtotal - billDiscount.discountAmount + tax.taxAmount), 516.07);

console.log('sales math smoke tests passed');
