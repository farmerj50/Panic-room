// One-time backfill: recomputes User.phoneHash and TrustedContact.phoneHash
// under the fixed normalizePhoneDigits (see src/utils/phone.js) so numbers
// saved in different formats — e.g. a recipient's own "+15551234567" vs a
// sender's contact entry of "5551234567" — hash identically and match.
//
// Changing the normalization function alone only affects *new* saves; this
// script fixes rows that already exist with a hash computed the old way.
//
// Usage:
//   node scripts/backfillPhoneHashes.js            # apply changes
//   node scripts/backfillPhoneHashes.js --dry-run   # report only, no writes
//
// Safe to re-run: rows whose recomputed hash already matches the stored
// value are left untouched and don't count as updates.

const prisma = require("../src/config/db");
const { safeDecrypt, hashLookup } = require("../src/services/cryptoService");
const { normalizePhoneDigits } = require("../src/utils/phone");

const DRY_RUN = process.argv.includes("--dry-run");

async function backfillUsers() {
  const users = await prisma.user.findMany({
    where: { phoneEncrypted: { not: null } },
    select: { id: true, phoneEncrypted: true, phoneHash: true },
  });

  let updated = 0;
  let unchanged = 0;
  let decryptFailed = 0;
  let conflicts = 0;

  for (const user of users) {
    const plaintext = safeDecrypt(user.phoneEncrypted);
    if (!plaintext) {
      decryptFailed++;
      console.warn(`[users] ${user.id}: could not decrypt phoneEncrypted, skipped`);
      continue;
    }

    const newHash = hashLookup(normalizePhoneDigits(plaintext));
    if (newHash === user.phoneHash) {
      unchanged++;
      continue;
    }

    console.log(`[users] ${user.id}: phoneHash ${user.phoneHash} -> ${newHash}${DRY_RUN ? " (dry run)" : ""}`);
    if (DRY_RUN) {
      updated++;
      continue;
    }

    try {
      await prisma.user.update({ where: { id: user.id }, data: { phoneHash: newHash } });
      updated++;
    } catch (error) {
      if (error?.code === "P2002") {
        conflicts++;
        console.error(
          `[users] ${user.id}: recomputed hash collides with another user's phoneHash — left unchanged, needs manual review`,
        );
      } else {
        throw error;
      }
    }
  }

  return { updated, unchanged, decryptFailed, conflicts, total: users.length };
}

async function backfillContacts() {
  // phoneNumber is required (non-nullable) on TrustedContact, unlike
  // User.phoneEncrypted — no need to filter for it being set.
  const contacts = await prisma.trustedContact.findMany({
    select: { id: true, phoneNumber: true, phoneHash: true },
  });

  let updated = 0;
  let unchanged = 0;
  let decryptFailed = 0;

  for (const contact of contacts) {
    const plaintext = safeDecrypt(contact.phoneNumber);
    if (!plaintext) {
      decryptFailed++;
      console.warn(`[contacts] ${contact.id}: could not decrypt phoneNumber, skipped`);
      continue;
    }

    const newHash = hashLookup(normalizePhoneDigits(plaintext));
    if (newHash === contact.phoneHash) {
      unchanged++;
      continue;
    }

    console.log(`[contacts] ${contact.id}: phoneHash ${contact.phoneHash} -> ${newHash}${DRY_RUN ? " (dry run)" : ""}`);
    if (DRY_RUN) {
      updated++;
      continue;
    }

    // No unique constraint on TrustedContact.phoneHash — nothing to conflict with.
    await prisma.trustedContact.update({ where: { id: contact.id }, data: { phoneHash: newHash } });
    updated++;
  }

  return { updated, unchanged, decryptFailed, total: contacts.length };
}

async function main() {
  console.log(`Backfilling phone hashes${DRY_RUN ? " (DRY RUN — no writes)" : ""}...`);

  const userResult = await backfillUsers();
  console.log(
    `Users: ${userResult.total} total, ${userResult.updated} updated, ${userResult.unchanged} already correct, ` +
      `${userResult.decryptFailed} undecryptable, ${userResult.conflicts} hash conflicts (manual review needed)`,
  );

  const contactResult = await backfillContacts();
  console.log(
    `Contacts: ${contactResult.total} total, ${contactResult.updated} updated, ${contactResult.unchanged} already correct, ` +
      `${contactResult.decryptFailed} undecryptable`,
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
