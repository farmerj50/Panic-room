// LOCAL-BACKEND-ONLY helpers for socialSharing.e2e.js. Talks straight to
// the local dev database (backend/.env) — never run against production.
//
// Social connections are seeded with FAKE tokens: the emergency Share flow
// appears, but any real TikTok/Instagram call is rejected by the provider,
// so nothing can actually be published.
const path = require('path');

const BACKEND = path.join(__dirname, '..', '..', '..', 'backend');
require(path.join(BACKEND, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND, '.env'), quiet: true });
const prisma = require(path.join(BACKEND, 'src', 'config', 'db'));
const { encrypt, hashLookup } = require(path.join(BACKEND, 'src', 'services', 'cryptoService'));

async function findUser(email) {
  const user = await prisma.user.findFirst({ where: { emailHash: hashLookup(email) } });
  if (!user) throw new Error(`No user for ${email}`);
  return user;
}

async function seedFakeSocialConnections(email) {
  const user = await findUser(email);
  for (const provider of ['tiktok', 'instagram']) {
    const data = {
      status: 'connected',
      enabledForEmergency: true,
      providerUsername: `e2e_${provider}`,
      providerUserId: `e2e_${provider}_id`,
      accessTokenEncrypted: encrypt('FAKE_E2E_TOKEN'),
      refreshTokenEncrypted: provider === 'tiktok' ? encrypt('FAKE_E2E_REFRESH') : null,
      expiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000),
    };
    await prisma.socialConnection.upsert({
      where: { userId_provider: { userId: user.id, provider } },
      create: { userId: user.id, provider, ...data },
      update: data,
    });
  }
  return user.id;
}

async function trustedContactCount(email) {
  const user = await findUser(email);
  return prisma.trustedContact.count({ where: { userId: user.id } });
}

// Segments uploaded for this user's most recent emergency.
async function latestEmergencySegments(email) {
  const user = await findUser(email);
  const emergency = await prisma.emergencyEvent.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: { videoSegments: { orderBy: { sequence: 'asc' } } },
  });
  return emergency ? emergency.videoSegments.map((s) => s.sequence) : [];
}

async function disconnect() {
  await prisma.$disconnect();
}

module.exports = { seedFakeSocialConnections, trustedContactCount, latestEmergencySegments, disconnect };
