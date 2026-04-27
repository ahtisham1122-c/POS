import { useState, useEffect } from 'react';
import { getDB, KEYS } from './db';

export function useDB() {
  const [data, setData] = useState({
    products: getDB(KEYS.PRODUCTS),
    customers: getDB(KEYS.CUSTOMERS),
    sales: getDB(KEYS.SALES),
    saleItems: getDB(KEYS.SALE_ITEMS),
    payments: getDB(KEYS.PAYMENTS),
    ledger: getDB(KEYS.LEDGER),
    stockMovements: getDB(KEYS.STOCK_MOVEMENTS),
    expenses: getDB(KEYS.EXPENSES),
    dailyRates: getDB(KEYS.DAILY_RATES),
    cashRegister: getDB(KEYS.CASH_REGISTER),
    settings: getDB(KEYS.SETTINGS),
    heldBills: getDB(KEYS.HELD_BILLS),
  });

  useEffect(() => {
    const handler = () => {
      setData({
        products: getDB(KEYS.PRODUCTS),
        customers: getDB(KEYS.CUSTOMERS),
        sales: getDB(KEYS.SALES),
        saleItems: getDB(KEYS.SALE_ITEMS),
        payments: getDB(KEYS.PAYMENTS),
        ledger: getDB(KEYS.LEDGER),
        stockMovements: getDB(KEYS.STOCK_MOVEMENTS),
        expenses: getDB(KEYS.EXPENSES),
        dailyRates: getDB(KEYS.DAILY_RATES),
        cashRegister: getDB(KEYS.CASH_REGISTER),
        settings: getDB(KEYS.SETTINGS),
        heldBills: getDB(KEYS.HELD_BILLS),
      });
    };
    window.addEventListener('db_updated', handler);
    return () => window.removeEventListener('db_updated', handler);
  }, []);

  return data;
}

export const formatCurrency = (amt: number) => `Rs. ${Number(amt || 0).toLocaleString('en-PK')}`;
export const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
};
