import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Pool } from 'pg';

import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const username = 'tawan';
  const password = '123456';
  const accountName = 't';

  // Check if user exists
  let user = await prisma.user.findUnique({
    where: { username },
  });

  if (!user) {
    const hashedPassword = await bcrypt.hash(password, 10);
    user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
      },
    });
    console.log(`Created user: ${username}`);
  } else {
    console.log(`User ${username} already exists, skipping creation.`);
  }

  // Create account
  let account = await prisma.genshinAccount.findFirst({
    where: {
      userId: user.id,
      accountName,
    },
  });

  if (!account) {
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const hashedSecret = await bcrypt.hash(rawSecret, 10);

    account = await prisma.genshinAccount.create({
      data: {
        accountName,
        userId: user.id,
        importKeyHash: hashedSecret,
      },
    });
    console.log(`Created account ${accountName} for user ${username}`);
  } else {
    console.log(`Account ${accountName} already exists for user ${username}, skipping creation.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
