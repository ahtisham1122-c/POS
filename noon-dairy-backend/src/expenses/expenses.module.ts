import { Module, Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Injectable } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { CodeGeneratorService } from '../code-generator/code-generator.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ExpenseCategory } from '@prisma/client';
import { IsString, IsEnum, IsNumber, IsOptional } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateExpenseDto {
  @IsString() expenseDate!: string;
  @IsEnum(ExpenseCategory) category!: ExpenseCategory;
  @IsString() description!: string;
  @IsNumber() amount!: number;
}

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService, private gen: CodeGeneratorService) {}
  async create(dto: CreateExpenseDto, user: any) {
    return this.prisma.$transaction(async tx => {
      const code = await this.gen.generate(tx, 'expense', 'code', 'EXP', 4);
      const e = await tx.expense.create({
        data: { ...dto, expenseDate: new Date(dto.expenseDate), createdById: user.id, code }
      });
      const cr = await tx.cashRegister.findFirst({ where: { isClosedForDay: false }, orderBy: { date: 'desc' } });
      if (cr) await tx.cashRegister.update({ where: { id: cr.id }, data: { cashOut: { increment: dto.amount } } });
      return e;
    });
  }
  async findAll() { return this.prisma.expense.findMany({ orderBy: { expenseDate: 'desc' }, take: 50 }); }
}

@ApiTags('expenses')
@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER')
export class ExpensesController {
  constructor(private readonly s: ExpensesService) {}
  @Post() create(@Body() dto: CreateExpenseDto, @CurrentUser() u: any) { return this.s.create(dto, u); }
  @Get() findAll() { return this.s.findAll(); }
}
@Module({ providers: [ExpensesService], controllers: [ExpensesController] })
export class ExpensesModule {}
