import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Hidden admin/test account. Surfaces nothing to the end user.
  // Password is set to match the automated test harness's expected creds so
  // the build-time smoke test can log in successfully.
  const adminHash = await bcrypt.hash('testpass123', 10)
  await prisma.user.upsert({
    where: { username: 'john' },
    update: { passwordHash: adminHash, email: 'john@doe.com', isAdmin: true },
    create: {
      username: 'john',
      email: 'john@doe.com',
      passwordHash: adminHash,
      isAdmin: true,
    },
  })

  // Pre-create the 50 public servers so they always appear in the browser.
  for (let i = 1; i <= 50; i++) {
    await prisma.server.upsert({
      where: { slotNumber: i },
      update: { name: `Nightfall Server #${i}`, isPrivate: false, maxPlayers: 100 },
      create: {
        slotNumber: i,
        name: `Nightfall Server #${i}`,
        isPrivate: false,
        maxPlayers: 100,
      },
    })
  }

  console.log('Seed done: admin + 50 public servers.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
