export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function requirePositiveNumber(value: unknown, fieldName: string) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`${fieldName} must be greater than zero`);
  }
  return numberValue;
}

export function requireNonNegativeNumber(value: unknown, fieldName: string) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new Error(`${fieldName} cannot be negative`);
  }
  return numberValue;
}

export function resolveSaleUnitPrice(product: any, dailyRate: any) {
  const code = String(product.code || '').toUpperCase();

  if (code === 'MILK' && Number(dailyRate?.milk_rate) > 0) {
    return Number(dailyRate.milk_rate);
  }

  if ((code === 'YOGT' || code === 'YOGURT') && Number(dailyRate?.yogurt_rate) > 0) {
    return Number(dailyRate.yogurt_rate);
  }

  return Number(product.selling_price || 0);
}

export function calculateDiscount(subtotal: number, discountType: string, discountValueInput: unknown) {
  if (discountType === 'NONE') {
    return { discountType: 'NONE', discountValue: 0, discountAmount: 0 };
  }

  const discountValue = requireNonNegativeNumber(discountValueInput, 'Discount');
  if (discountValue === 0) {
    return { discountType: 'NONE', discountValue: 0, discountAmount: 0 };
  }

  if (discountType === 'PERCENT') {
    if (discountValue > 100) {
      throw new Error('Percentage discount cannot be more than 100%');
    }
    return {
      discountType,
      discountValue,
      discountAmount: roundMoney(subtotal * (discountValue / 100))
    };
  }

  if (discountType === 'RS') {
    if (discountValue > subtotal) {
      throw new Error('Discount cannot be greater than the bill subtotal');
    }
    return {
      discountType,
      discountValue,
      discountAmount: roundMoney(discountValue)
    };
  }

  throw new Error('Invalid discount type');
}

export function calculateItemDiscount(grossLineTotal: number, discountType: string, discountValueInput: unknown) {
  if (!discountType || discountType === 'NONE') {
    return { discountType: 'NONE', discountValue: 0, discountAmount: 0 };
  }

  const discountValue = requireNonNegativeNumber(discountValueInput, 'Item discount');
  if (discountValue === 0) {
    return { discountType: 'NONE', discountValue: 0, discountAmount: 0 };
  }

  if (discountType === 'PERCENT') {
    if (discountValue > 100) throw new Error('Item percentage discount cannot be more than 100%');
    return { discountType, discountValue, discountAmount: roundMoney(grossLineTotal * (discountValue / 100)) };
  }

  if (discountType === 'RS') {
    if (discountValue > grossLineTotal) throw new Error('Item discount cannot be greater than the item total');
    return { discountType, discountValue, discountAmount: roundMoney(discountValue) };
  }

  throw new Error('Invalid item discount type');
}

export function calculateTax({
  subtotal,
  taxableSubtotal,
  discountAmount,
  taxEnabled,
  taxRate
}: {
  subtotal: number;
  taxableSubtotal: number;
  discountAmount: number;
  taxEnabled: boolean;
  taxRate: number;
}) {
  if (!taxEnabled || taxRate <= 0 || taxableSubtotal <= 0 || subtotal <= 0) {
    return {
      taxEnabled: false,
      taxableAmount: 0,
      taxAmount: 0
    };
  }

  const taxableShare = taxableSubtotal / subtotal;
  const taxableDiscount = roundMoney(discountAmount * taxableShare);
  const taxableAmount = roundMoney(Math.max(0, taxableSubtotal - taxableDiscount));
  const taxAmount = roundMoney(taxableAmount * (taxRate / 100));

  return {
    taxEnabled: true,
    taxableAmount,
    taxAmount
  };
}
