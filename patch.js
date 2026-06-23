const fs = require('fs');
const file = 'src/genshin-accounts/genshin-accounts.service.ts';
let code = fs.readFileSync(file, 'utf8');

const newMethod = `
  async deleteSnapshots(userId: number, accountId: number, snapshotIds: number[], selectAll?: boolean | string) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id: accountId, userId },
    });
    if (!account) throw new NotFoundException('Account not found');

    const isSelectAll = selectAll === true || selectAll === 'true';

    if (!isSelectAll && (!snapshotIds || snapshotIds.length === 0)) {
      return { message: 'No snapshots provided for deletion' };
    }

    try {
      const whereClause: any = {
        genshinAccountId: accountId,
        isDeleted: false 
      };
      
      if (!isSelectAll) {
        whereClause.id = { in: snapshotIds };
      }

      const result = await this.prisma.good.updateMany({
        where: whereClause,
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });
      return { message: \`Successfully deleted \${result.count} snapshots\`, count: result.count };
    } catch (error: any) {
      this.logger.error('Failed to bulk delete snapshots', error.stack);
      throw new BadRequestException('Failed to delete snapshots');
    }
  }
}
`;

code = code.replace(/}\n$/, newMethod);
fs.writeFileSync(file, code);
console.log('Patched');
