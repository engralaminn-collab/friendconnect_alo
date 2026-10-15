const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const db = new PrismaClient();

async function main() {
  const users = [
    { email: 'admin@panel.alolabs.net', username: 'admin', name: 'ALO Admin', password: 'Admin2026!@#', role: 'ADMIN' },
    { email: 'alice@test.com', username: 'alice_test', name: 'Alice Johnson', password: 'Test1234!', role: 'USER' },
    { email: 'bob@test.com', username: 'bob_test', name: 'Bob Smith', password: 'Test1234!', role: 'USER' },
    { email: 'sara@test.com', username: 'sara_test', name: 'Sara Ahmed', password: 'Test1234!', role: 'USER' },
    { email: 'john@test.com', username: 'john_test', name: 'John Doe', password: 'Test1234!', role: 'USER' },
  ];

  for (const u of users) {
    const existing = await db.user.findUnique({ where: { email: u.email } });
    if (existing) { console.log(`⏭️  Exists: ${u.email}`); continue; }

    const hash = await bcrypt.hash(u.password, 10);

    try {
      await db.user.create({
        data: {
          email: u.email,
          username: u.username,
          name: u.name,
          passwordHash: hash,
          isVerified: true,
          emailVerified: true,
          role: u.role,
        }
      });
      console.log(`✅ Created: ${u.email} | password: ${u.password}`);
    } catch(e) {
      console.log(`❌ Failed: ${u.email} → ${e.message}`);
    }
  }

  const count = await db.user.count();
  console.log(`\nTotal users: ${count}`);
}

main()
  .catch(e => console.error('❌', e.message))
  .finally(() => db.$disconnect());
