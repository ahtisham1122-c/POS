const fs = require('fs');
const path = require('path');

function create(fp, content) {
  const fullPath = path.join(process.cwd(), fp);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content.trim() + '\n');
}

create('noon-dairy-backend/package.json', `
{
  "name": "noon-dairy-backend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "format": "prettier --write \\"src/**/*.ts\\"",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "db:migrate": "prisma migrate dev",
    "db:push": "prisma db push",
    "db:seed": "ts-node prisma/seed.ts",
    "db:studio": "prisma studio",
    "db:reset": "prisma migrate reset"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/config": "^3.2.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/passport": "^10.0.3",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/swagger": "^7.3.0",
    "@prisma/client": "^5.10.0",
    "bcrypt": "^5.1.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "reflect-metadata": "^0.2.1",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@types/bcrypt": "^5.0.2",
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.24",
    "@types/passport-jwt": "^4.0.1",
    "prisma": "^5.10.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}
`);

create('noon-dairy-backend/tsconfig.json', `
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "strictNullChecks": true,
    "strict": true
  }
}
`);

create('noon-dairy-backend/.env.example', `
DATABASE_URL="postgresql://user:password@localhost:5432/noon_dairy"
JWT_SECRET="change-this-to-a-long-random-secret"
JWT_EXPIRES_IN="8h"
JWT_REFRESH_SECRET="change-this-refresh-secret"
JWT_REFRESH_EXPIRES_IN="30d"
PORT=3000
NODE_ENV=development
`);

create('noon-dairy-backend/prisma/schema.prisma', `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id           String   @id @default(cuid())
  name         String
  username     String   @unique
  passwordHash String
  role         Role     @default(CASHIER)
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  sales        Sale[]
  activityLogs ActivityLog[]
  @@index([username])
}

enum Role {
  ADMIN
  MANAGER
  CASHIER
  STAFF
}

model Product {
  id                String          @id @default(cuid())
  code              String          @unique
  name              String
  category          ProductCategory
  unit              String
  sellingPrice      Decimal         @db.Decimal(10, 2)
  costPrice         Decimal         @db.Decimal(10, 2)
  stock             Decimal         @db.Decimal(10, 3)
  lowStockThreshold Decimal         @db.Decimal(10, 3) @default(5)
  emoji             String          @default("📦")
  isActive          Boolean         @default(true)
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  saleItems         SaleItem[]
  stockMovements    StockMovement[]
  @@index([category])
  @@index([code])
}

enum ProductCategory {
  MILK
  YOGURT
  BUTTER_CREAM
  DRINKS
  CHEESE
  SWEETS
  OTHER
}

model DailyRate {
  id          String   @id @default(cuid())
  date        DateTime @db.Date
  milkRate    Decimal  @db.Decimal(10, 2)
  yogurtRate  Decimal  @db.Decimal(10, 2)
  updatedById String
  createdAt   DateTime @default(now())
  @@unique([date])
  @@index([date])
}

model Customer {
  id             String        @id @default(cuid())
  code           String        @unique
  cardNumber     String?       @unique
  name           String
  phone          String?
  address        String?
  creditLimit    Decimal       @db.Decimal(10, 2) @default(0)
  currentBalance Decimal       @db.Decimal(10, 2) @default(0)
  isActive       Boolean       @default(true)
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  sales          Sale[]
  ledgerEntries  LedgerEntry[]
  payments       Payment[]
  @@index([phone])
  @@index([name])
  @@index([cardNumber])
}

model Sale {
  id             String        @id @default(cuid())
  billNumber     String        @unique
  saleDate       DateTime      @default(now())
  customerId     String?
  cashierId      String
  paymentType    PaymentType
  subtotal       Decimal       @db.Decimal(10, 2)
  discountType   DiscountType  @default(NONE)
  discountValue  Decimal       @db.Decimal(10, 2) @default(0)
  discountAmount Decimal       @db.Decimal(10, 2) @default(0)
  grandTotal     Decimal       @db.Decimal(10, 2)
  amountPaid     Decimal       @db.Decimal(10, 2)
  balanceDue     Decimal       @db.Decimal(10, 2) @default(0)
  status         SaleStatus    @default(COMPLETED)
  notes          String?
  createdAt      DateTime      @default(now())
  customer       Customer?     @relation(fields: [customerId], references: [id])
  cashier        User          @relation(fields: [cashierId], references: [id])
  items          SaleItem[]
  payments       Payment[]
  ledgerEntries  LedgerEntry[]
  @@index([saleDate])
  @@index([customerId])
  @@index([billNumber])
  @@index([paymentType])
}

enum PaymentType { CASH \\n CREDIT \\n PARTIAL }
enum SaleStatus  { COMPLETED \\n HELD \\n RETURNED \\n CANCELLED }
enum DiscountType { NONE \\n FLAT \\n PERCENTAGE }

model SaleItem {
  id          String  @id @default(cuid())
  saleId      String
  productId   String
  productName String
  unit        String
  quantity    Decimal @db.Decimal(10, 3)
  unitPrice   Decimal @db.Decimal(10, 2)
  costPrice   Decimal @db.Decimal(10, 2)
  lineTotal   Decimal @db.Decimal(10, 2)
  sale        Sale    @relation(fields: [saleId], references: [id], onDelete: Cascade)
  product     Product @relation(fields: [productId], references: [id])
  @@index([saleId])
  @@index([productId])
}

model LedgerEntry {
  id           String          @id @default(cuid())
  customerId   String
  saleId       String?
  paymentId    String?
  entryType    LedgerEntryType
  amount       Decimal         @db.Decimal(10, 2)
  balanceAfter Decimal         @db.Decimal(10, 2)
  description  String
  entryDate    DateTime        @default(now())
  createdAt    DateTime        @default(now())
  customer     Customer        @relation(fields: [customerId], references: [id])
  sale         Sale?           @relation(fields: [saleId], references: [id])
  payment      Payment?        @relation(fields: [paymentId], references: [id])
  @@index([customerId])
  @@index([entryDate])
}

enum LedgerEntryType {
  SALE_CREDIT
  PAYMENT_RECEIVED
  ADVANCE_PAYMENT
  ADJUSTMENT
}

model Payment {
  id            String        @id @default(cuid())
  customerId    String
  saleId        String?
  amount        Decimal       @db.Decimal(10, 2)
  paymentDate   DateTime      @default(now())
  collectedById String
  notes         String?
  createdAt     DateTime      @default(now())
  customer      Customer      @relation(fields: [customerId], references: [id])
  sale          Sale?         @relation(fields: [saleId], references: [id])
  ledgerEntries LedgerEntry[]
  @@index([customerId])
  @@index([paymentDate])
}

model StockMovement {
  id           String            @id @default(cuid())
  productId    String
  movementType StockMovementType
  quantity     Decimal           @db.Decimal(10, 3)
  stockBefore  Decimal           @db.Decimal(10, 3)
  stockAfter   Decimal           @db.Decimal(10, 3)
  referenceId  String?
  supplier     String?
  notes        String?
  createdById  String
  createdAt    DateTime          @default(now())
  product      Product           @relation(fields: [productId], references: [id])
  @@index([productId])
  @@index([createdAt])
  @@index([movementType])
}

enum StockMovementType { STOCK_IN \\n STOCK_OUT \\n WASTAGE \\n ADJUSTMENT \\n OPENING }

model Expense {
  id          String          @id @default(cuid())
  code        String          @unique
  expenseDate DateTime        @db.Date
  category    ExpenseCategory
  description String
  amount      Decimal         @db.Decimal(10, 2)
  createdById String
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  @@index([expenseDate])
  @@index([category])
}

enum ExpenseCategory {
  MILK_PURCHASE \\n SALARY \\n ELECTRICITY \\n FUEL \\n PACKAGING \\n RENT \\n MAINTENANCE \\n CLEANING \\n MISCELLANEOUS
}

model CashRegister {
  id             String    @id @default(cuid())
  date           DateTime  @db.Date @unique
  openingBalance Decimal   @db.Decimal(10, 2) @default(0)
  cashIn         Decimal   @db.Decimal(10, 2) @default(0)
  cashOut        Decimal   @db.Decimal(10, 2) @default(0)
  closingBalance Decimal   @db.Decimal(10, 2) @default(0)
  isClosedForDay Boolean   @default(false)
  closedById     String?
  closedAt       DateTime?
  createdAt      DateTime  @default(now())
  @@index([date])
}

model ActivityLog {
  id        String   @id @default(cuid())
  userId    String
  action    String
  entity    String
  entityId  String?
  details   Json?
  ipAddress String?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
  @@index([userId])
  @@index([createdAt])
  @@index([action])
}

model Setting {
  id        String   @id @default(cuid())
  key       String   @unique
  value     String
  updatedAt DateTime @updatedAt
}
`);

create('noon-dairy-backend/src/main.ts', `
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.enableCors();
  app.setGlobalPrefix('api');
  
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));
  
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  const config = new DocumentBuilder()
    .setTitle('Noon Dairy API')
    .setDescription('The Noon Dairy POS Backend API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(\`Application is running on: http://localhost:\${port}\`);
}
bootstrap();
`);

create('noon-dairy-backend/src/common/interceptors/response.interceptor.ts', `
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  success: boolean;
  data: T;
  message: string;
  timestamp: string;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    return next.handle().pipe(
      map(data => ({
        success: true,
        data: data?.data || data,
        message: data?.message || 'Operation successful',
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
`);

create('noon-dairy-backend/src/common/filters/http-exception.filter.ts', `
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    
    const status = exception instanceof HttpException 
      ? exception.getStatus() 
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Internal server error';
    let error = 'INTERNAL_SERVER_ERROR';

    if (exception instanceof HttpException) {
      const res = exception.getResponse() as any;
      message = res.message || res;
      error = res.error || 'BAD_REQUEST';
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // Convert NestJS validation arrays to string
    if (Array.isArray(message)) {
      message = message.join(', ');
      error = 'VALIDATION_ERROR';
    }

    response.status(status).json({
      success: false,
      error: error,
      message: message,
      statusCode: status,
      timestamp: new Date().toISOString(),
    });
  }
}
`);

console.log("Part 1 base structure scripts generated successfully.");
