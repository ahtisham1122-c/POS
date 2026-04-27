import { Module, Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Injectable, NotFoundException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { CodeGeneratorService } from '../code-generator/code-generator.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ProductCategory } from '@prisma/client';
import { IsString, IsEnum, IsNumber, IsOptional, IsBoolean } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateProductDto {
  @IsString() name!: string;
  @IsEnum(ProductCategory) category!: ProductCategory;
  @IsString() unit!: string;
  @IsNumber() sellingPrice!: number;
  @IsNumber() costPrice!: number;
  @IsNumber() stock!: number;
  @IsNumber() @IsOptional() lowStockThreshold?: number;
  @IsString() @IsOptional() emoji?: string;
}
export class UpdateProductDto {
  @IsString() @IsOptional() name?: string;
  @IsEnum(ProductCategory) @IsOptional() category?: ProductCategory;
  @IsString() @IsOptional() unit?: string;
}
export class UpdatePriceDto {
  @IsNumber() sellingPrice!: number;
  @IsNumber() costPrice!: number;
}
export class StockInDto {
  @IsNumber() quantity!: number;
  @IsString() @IsOptional() supplier?: string;
  @IsString() @IsOptional() notes?: string;
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService, private generator: CodeGeneratorService) {}

  async findAll(category?: ProductCategory, search?: string, includeInactive = false) {
    return this.prisma.product.findMany({
      where: {
        isActive: includeInactive ? undefined : true,
        category: category ? category : undefined,
        name: search ? { contains: search, mode: 'insensitive' } : undefined,
      },
      orderBy: { name: 'asc' }
    });
  }

  async findOne(id: string) {
    const prod = await this.prisma.product.findUnique({
      where: { id },
      include: { stockMovements: { orderBy: { createdAt: 'desc' }, take: 5 } }
    });
    if (!prod) throw new NotFoundException({ error: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    return prod;
  }

  async create(dto: CreateProductDto) {
    return this.prisma.$transaction(async tx => {
      const code = await this.generator.generate(tx, 'product', 'code', 'PRD', 3);
      const prod = await tx.product.create({
        data: { ...dto, code }
      });
      if (dto.stock > 0) {
        await tx.stockMovement.create({
          data: {
            productId: prod.id, movementType: 'OPENING', quantity: dto.stock,
            stockBefore: 0, stockAfter: dto.stock, createdById: 'system', notes: 'Initial stock'
          }
        });
      }
      return prod;
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async updatePrice(id: string, dto: UpdatePriceDto) {
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    return this.prisma.product.update({ where: { id }, data: { isActive: false } });
  }

  async stockIn(id: string, dto: StockInDto, user: any) {
    return this.prisma.$transaction(async tx => {
      const prod = await tx.product.findUnique({ where: { id } });
      if (!prod) throw new NotFoundException();
      const newStock = Number(prod.stock) + dto.quantity;
      await tx.product.update({ where: { id }, data: { stock: newStock } });
      await tx.stockMovement.create({
        data: {
          productId: id, movementType: 'STOCK_IN', quantity: dto.quantity,
          stockBefore: prod.stock, stockAfter: newStock, supplier: dto.supplier,
          notes: dto.notes, createdById: user.id
        }
      });
      return { stock: newStock };
    });
  }
}

@ApiTags('products')
@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Roles('ADMIN', 'MANAGER', 'CASHIER', 'STAFF')
  @Get() findAll(@Query('category') category: any, @Query('search') search: string, @Query('includeInactive') inc: boolean) {
    return this.service.findAll(category, search, inc);
  }
  @Roles('ADMIN', 'MANAGER', 'CASHIER', 'STAFF')
  @Get(':id') findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Roles('ADMIN', 'MANAGER') @Post() create(@Body() dto: CreateProductDto) { return this.service.create(dto); }
  @Roles('ADMIN', 'MANAGER') @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateProductDto) { return this.service.update(id, dto); }
  @Roles('ADMIN', 'MANAGER') @Patch(':id/price') updatePrice(@Param('id') id: string, @Body() dto: UpdatePriceDto) { return this.service.updatePrice(id, dto); }
  @Roles('ADMIN') @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }
  
  @Roles('ADMIN', 'MANAGER') @Post(':id/stock-in') stockIn(@Param('id') id: string, @Body() dto: StockInDto, @CurrentUser() user: any) {
    return this.service.stockIn(id, dto, user);
  }
}

@Module({ providers: [ProductsService], controllers: [ProductsController], exports: [ProductsService] })
export class ProductsModule {}
