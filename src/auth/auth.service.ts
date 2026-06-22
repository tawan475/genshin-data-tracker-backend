import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES,
  JWT_REFRESH_EXPIRES,
} from './constants';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });

    if (existing) {
      throw new ConflictException('Username already taken');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        password: hashedPassword,
      },
    });

    return this.generateTokens(user.id, user.username);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.generateTokens(user.id, user.username);
  }

  async refresh(refreshToken: string) {
    let payload: { sub: number; username: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || user.refreshTokens.length === 0) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const matches = await Promise.all(
      user.refreshTokens.map((hash) => bcrypt.compare(refreshToken, hash))
    );
    const matchIndex = matches.findIndex((m) => m);

    if (matchIndex === -1) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const oldHash = user.refreshTokens[matchIndex];
    return this.generateTokens(user.id, user.username, oldHash);
  }

  async logout(userId: number) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokens: [] },
    });
  }

  private async generateTokens(userId: number, username: string, oldRefreshTokenHash?: string) {
    const payload = { sub: userId, username };

    const accessToken = this.jwtService.sign(payload, {
      secret: JWT_ACCESS_SECRET,
      expiresIn: JWT_ACCESS_EXPIRES,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: JWT_REFRESH_SECRET,
      expiresIn: JWT_REFRESH_EXPIRES,
    });

    const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);
    
    if (oldRefreshTokenHash) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      const updatedTokens = user?.refreshTokens.filter(h => h !== oldRefreshTokenHash) || [];
      updatedTokens.push(hashedRefreshToken);
      
      await this.prisma.user.update({
        where: { id: userId },
        data: { refreshTokens: updatedTokens },
      });
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: { refreshTokens: { push: hashedRefreshToken } },
      });
    }

    return { accessToken, refreshToken };
  }
}
