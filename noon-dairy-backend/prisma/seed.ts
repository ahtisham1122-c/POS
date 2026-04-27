import { PrismaClient, ProductCategory, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminPassword = await bcrypt.hash('admin123', 12);

  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {
      name: 'System Admin',
      role: Role.ADMIN,
      isActive: true,
      passwordHash: adminPassword
    },
    create: {
      name: 'System Admin',
      username: 'admin',
      passwordHash: adminPassword,
      role: Role.ADMIN,
      isActive: true
    }
  });

  const products = [
    { code: 'PRD-001', name: 'Fresh Milk 1L', category: ProductCategory.MILK, unit: 'ltr', sellingPrice: 220, costPrice: 185, stock: 150, emoji: 'MILK' },
    { code: 'PRD-002', name: 'Fresh Milk 500ml', category: ProductCategory.MILK, unit: 'pcs', sellingPrice: 120, costPrice: 95, stock: 180, emoji: 'MILK' },
    { code: 'PRD-003', name: 'Yogurt 500g', category: ProductCategory.YOGURT, unit: 'pcs', sellingPrice: 170, costPrice: 140, stock: 80, emoji: 'YOG' },
    { code: 'PRD-004', name: 'Yogurt 1kg', category: ProductCategory.YOGURT, unit: 'pcs', sellingPrice: 320, costPrice: 270, stock: 60, emoji: 'YOG' },
    { code: 'PRD-005', name: 'Cream 250g', category: ProductCategory.BUTTER_CREAM, unit: 'pcs', sellingPrice: 260, costPrice: 215, stock: 40, emoji: 'CRM' },
    { code: 'PRD-006', name: 'Butter 500g', category: ProductCategory.BUTTER_CREAM, unit: 'pcs', sellingPrice: 650, costPrice: 560, stock: 35, emoji: 'BTR' },
    { code: 'PRD-007', name: 'Lassi Sweet 1L', category: ProductCategory.DRINKS, unit: 'btl', sellingPrice: 240, costPrice: 195, stock: 90, emoji: 'LAS' },
    { code: 'PRD-008', name: 'Cheese Block 200g', category: ProductCategory.CHEESE, unit: 'pcs', sellingPrice: 380, costPrice: 315, stock: 50, emoji: 'CHS' }
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { code: p.code },
      update: {
        name: p.name,
        category: p.category,
        unit: p.unit,
        sellingPrice: p.sellingPrice,
        costPrice: p.costPrice,
        stock: p.stock,
        lowStockThreshold: 5,
        emoji: p.emoji,
        isActive: true
      },
      create: {
        code: p.code,
        name: p.name,
        category: p.category,
        unit: p.unit,
        sellingPrice: p.sellingPrice,
        costPrice: p.costPrice,
        stock: p.stock,
        lowStockThreshold: 5,
        emoji: p.emoji,
        isActive: true
      }
    });
  }

  const customers = [
    { code: 'CUST-001', name: 'Ahmed Traders', phone: '03001234567', address: 'Model Town, Lahore', creditLimit: 25000, currentBalance: 3500, cardNumber: 'ND-1001' },
    { code: 'CUST-002', name: 'Fatima Super Store', phone: '03111234567', address: 'Johar Town, Lahore', creditLimit: 20000, currentBalance: 0, cardNumber: 'ND-1002' },
    { code: 'CUST-003', name: 'Bilal Dairy Corner', phone: '03221234567', address: 'Faisal Town, Lahore', creditLimit: 15000, currentBalance: 1800, cardNumber: 'ND-1003' }
  ];

  for (const c of customers) {
    await prisma.customer.upsert({
      where: { code: c.code },
      update: {
        name: c.name,
        phone: c.phone,
        address: c.address,
        creditLimit: c.creditLimit,
        currentBalance: c.currentBalance,
        cardNumber: c.cardNumber,
        isActive: true
      },
      create: {
        code: c.code,
        name: c.name,
        phone: c.phone,
        address: c.address,
        creditLimit: c.creditLimit,
        currentBalance: c.currentBalance,
        cardNumber: c.cardNumber,
        isActive: true
      }
    });
  }

  const todayDateOnly = new Date().toISOString().split('T')[0];
  await prisma.dailyRate.upsert({
    where: { date: new Date(todayDateOnly) },
    update: {
      milkRate: 220,
      yogurtRate: 170,
      updatedById: admin.id
    },
    create: {
      date: new Date(todayDateOnly),
      milkRate: 220,
      yogurtRate: 170,
      updatedById: admin.id
    }
  });

  console.log('Seed completed: admin user, 8 products, 3 customers, daily rates.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
