import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class ImportKeyGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const token = authHeader.split(' ')[1];

    if (!token.startsWith('gdt_import_')) {
      throw new UnauthorizedException('Invalid import key format');
    }

    const parts = token.split('_');
    if (parts.length !== 4) {
      throw new UnauthorizedException('Invalid import key format');
    }

    const accountId = parseInt(parts[2], 10);
    const rawSecret = parts[3];

    if (isNaN(accountId)) {
      throw new UnauthorizedException('Invalid account ID in import key');
    }

    const account = await this.prisma.genshinAccount.findUnique({
      where: { id: accountId },
    });

    if (!account || !account.importKeyHash) {
      throw new UnauthorizedException('Invalid import key');
    }

    const isValid = await bcrypt.compare(rawSecret, account.importKeyHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid import key');
    }

    // Attach account to request so the controller knows which account is importing
    request.genshinAccount = account;
    return true;
  }
}
