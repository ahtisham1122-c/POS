import { Module, Controller, Get, UseGuards, Injectable } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}
  async getSummary() {
    const products = await this.prisma.product.findMany({ where: { isActive: true }});
    let stockValue = 0;
    let lowStock = 0;
    let outOfStock = 0;
    for (const p of products) {
      stockValue += Number(p.stock) * Number(p.costPrice);
      if (Number(p.stock) <= 0) outOfStock++;
      else if (Number(p.stock) <= Number(p.lowStockThreshold)) lowStock++;
    }
    return { productsCount: products.length, stockValue, lowStockCount: lowStock, outOfStockCount: outOfStock };
  }
}

@ApiTags('inventory')
@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly s: InventoryService) {}
  @Roles('ADMIN', 'MANAGER', 'STAFF') @Get('summary') getSummary() { return this.s.getSummary(); }
}
@Module({ providers: [InventoryService], controllers: [InventoryController] })
export class InventoryModule {}
