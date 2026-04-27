import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CodeGeneratorService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(
    tx: Prisma.TransactionClient,
    modelName: string,
    column: string,
    prefix: string,
    padding: number
  ): Promise<string> {
    const records = await (tx as any)[modelName].findMany({
      select: { [column]: true },
      orderBy: { [column]: 'desc' },
      take: 1,
    });
    
    let nextNum = 1;
    if (records.length > 0) {
      const lastCode = records[0][column];
      const parts = lastCode.split('-');
      if (parts.length > 1) {
        nextNum = parseInt(parts[1], 10) + 1;
      }
    }
    return `${prefix}-${nextNum.toString().padStart(padding, '0')}`;
  }
}
