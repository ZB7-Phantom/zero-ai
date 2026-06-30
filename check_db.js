const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const p = await prisma.patient.findFirst({ where: { name: 'Jane Doe' }});
  console.log({ nextAppointmentAt: p.nextAppointmentAt, recallStatus: p.recallStatus });
}

main().finally(() => prisma.$disconnect());
