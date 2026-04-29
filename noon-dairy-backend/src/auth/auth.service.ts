import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';

type JwtPayload = {
  sub: string;
  username: string;
  role: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private getRequiredEnv(name: string) {
    const value = process.env[name];
    if (!value) {
      throw new Error(`${name} is not configured`);
    }
    return value;
  }

  private getJwtExpiry(name: string, fallback: JwtSignOptions['expiresIn']): JwtSignOptions['expiresIn'] {
    return (process.env[name] || fallback) as JwtSignOptions['expiresIn'];
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password',
      });
    }

    if (!user.isActive) {
      throw new UnauthorizedException({
        error: 'UNAUTHORIZED',
        message: 'User account is disabled',
      });
    }

    return this.generateTokenPair(user);
  }

  async refresh(dto: RefreshDto) {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(dto.refreshToken, {
        secret: this.getRequiredEnv('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({
        error: 'UNAUTHORIZED',
        message: 'Invalid refresh token',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        error: 'UNAUTHORIZED',
        message: 'User disabled or not found',
      });
    }

    const activeTokens = await this.prisma.refreshToken.findMany({
      where: {
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const matched = await this.findMatchingRefreshToken(activeTokens, dto.refreshToken);
    if (!matched) {
      throw new UnauthorizedException({
        error: 'UNAUTHORIZED',
        message: 'Refresh token is not active',
      });
    }

    await this.prisma.refreshToken.update({
      where: { id: matched.id },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });

    return this.generateTokenPair(user);
  }

  async logout(userId: string, dto?: LogoutDto) {
    if (dto?.allDevices) {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { message: 'Logged out from all devices' };
    }

    if (dto?.refreshToken) {
      const candidates = await this.prisma.refreshToken.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      const matched = await this.findMatchingRefreshToken(candidates, dto.refreshToken);
      if (matched) {
        await this.prisma.refreshToken.update({
          where: { id: matched.id },
          data: { revokedAt: new Date() },
        });
      }
    }

    return { message: 'Logged out successfully' };
  }

  private async generateTokenPair(user: User) {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.getRequiredEnv('JWT_SECRET'),
      expiresIn: this.getJwtExpiry('JWT_EXPIRES_IN', '8h'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.getRequiredEnv('JWT_REFRESH_SECRET'),
      expiresIn: this.getJwtExpiry('JWT_REFRESH_EXPIRES_IN', '30d'),
    });

    const refreshTtlDays = Number(process.env.JWT_REFRESH_TTL_DAYS || 30);
    const tokenHash = await bcrypt.hash(refreshToken, 12);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + refreshTtlDays);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
      },
    };
  }

  private async findMatchingRefreshToken(
    tokens: Array<{ id: string; tokenHash: string }>,
    plainRefreshToken: string,
  ) {
    for (const token of tokens) {
      const match = await bcrypt.compare(plainRefreshToken, token.tokenHash);
      if (match) {
        return token;
      }
    }
    return null;
  }
}
