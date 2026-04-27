const fs = require('fs');
const path = require('path');

function create(fp, content) {
  const fullPath = path.join(process.cwd(), fp);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content.trim() + '\n');
}

create('noon-dairy-backend/src/common/decorators/roles.decorator.ts', `
import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
`);

create('noon-dairy-backend/src/common/decorators/current-user.decorator.ts', `
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
`);

create('noon-dairy-backend/src/prisma/prisma.service.ts', `
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
`);

create('noon-dairy-backend/src/prisma/prisma.module.ts', `
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
`);

create('noon-dairy-backend/src/code-generator/code-generator.service.ts', `
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
    return \`\${prefix}-\${nextNum.toString().padStart(padding, '0')}\`;
  }
}
`);

create('noon-dairy-backend/src/code-generator/code-generator.module.ts', `
import { Global, Module } from '@nestjs/common';
import { CodeGeneratorService } from './code-generator.service';

@Global()
@Module({
  providers: [CodeGeneratorService],
  exports: [CodeGeneratorService],
})
export class CodeGeneratorModule {}
`);

create('noon-dairy-backend/src/common/guards/jwt-auth.guard.ts', `
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
`);

create('noon-dairy-backend/src/common/guards/roles.guard.ts', `
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;
    
    const { user } = context.switchToHttp().getRequest();
    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException({ error: 'UNAUTHORIZED', message: 'Insufficient role permissions' });
    }
    return true;
  }
}
`);

create('noon-dairy-backend/src/auth/jwt.strategy.ts', `
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'secret',
    });
  }

  async validate(payload: any) {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'User disabled or not found' });
    return user;
  }
}
`);

// DTOs, Service, Controller in same code block for Auth
create('noon-dairy-backend/src/auth/auth.module.ts', `
import { Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Injectable, Body, Post, Controller, UseGuards, Get, Req, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { IsString } from 'class-validator';

export class LoginDto {
  @IsString() username!: string;
  @IsString() password!: string;
}
export class RefreshDto {
  @IsString() refreshToken!: string;
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException({ error: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
    }
    if (!user.isActive) throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Account disabled' });
    
    return this.generateTokens(user);
  }

  async refresh(dto: RefreshDto) {
    try {
      const payload = this.jwt.verify(dto.refreshToken, { secret: process.env.JWT_REFRESH_SECRET || 'refresh' });
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || !user.isActive) throw new UnauthorizedException();
      return this.generateTokens(user);
    } catch (e) {
      throw new UnauthorizedException({ error: 'UNAUTHORIZED', message: 'Invalid refresh token' });
    }
  }

  private generateTokens(user: any) {
    const payload = { sub: user.id, username: user.username, role: user.role };
    return {
      accessToken: this.jwt.sign(payload, { secret: process.env.JWT_SECRET || 'secret', expiresIn: process.env.JWT_EXPIRES_IN || '8h' }),
      refreshToken: this.jwt.sign(payload, { secret: process.env.JWT_REFRESH_SECRET || 'refresh', expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }),
      user: { id: user.id, username: user.username, role: user.role, name: user.name }
    };
  }
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) { return this.authService.login(dto); }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) { return this.authService.refresh(dto); }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout() { return { message: 'Logged out successfully' }; }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@Req() req: any) {
    const { passwordHash, ...safeUser } = req.user;
    return safeUser;
  }
}

@Module({
  imports: [PassportModule, JwtModule.register({})],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
})
export class AuthModule {}
`);

create('noon-dairy-backend/src/app.module.ts', `
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CodeGeneratorModule } from './code-generator/code-generator.module';
import { AuthModule } from './auth/auth.module';
// Will add more modules here in next step

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CodeGeneratorModule,
    AuthModule,
  ],
})
export class AppModule {}
`);
console.log("Part 2 base struct generated.");
