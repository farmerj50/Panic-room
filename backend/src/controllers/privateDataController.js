const prisma = require("../config/db");
const { decrypt, encrypt } = require("../services/cryptoService");

function isValidKey(key) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(key);
}

exports.getPrivateData = async (req, res, next) => {
  try {
    const { key } = req.params;
    if (!isValidKey(key)) return res.status(400).json({ error: "Invalid data key" });

    const record = await prisma.privateData.findUnique({
      where: {
        userId_key: {
          userId: req.user.id,
          key,
        },
      },
    });

    if (!record) return res.json({ data: null });

    res.json({ data: JSON.parse(decrypt(record.dataEncrypted)) });
  } catch (error) {
    next(error);
  }
};

exports.upsertPrivateData = async (req, res, next) => {
  try {
    const { key } = req.params;
    if (!isValidKey(key)) return res.status(400).json({ error: "Invalid data key" });

    const encrypted = encrypt(JSON.stringify(req.body.data ?? null));
    const record = await prisma.privateData.upsert({
      where: {
        userId_key: {
          userId: req.user.id,
          key,
        },
      },
      create: {
        userId: req.user.id,
        key,
        dataEncrypted: encrypted,
      },
      update: {
        dataEncrypted: encrypted,
      },
    });

    res.json({ key: record.key, updatedAt: record.updatedAt });
  } catch (error) {
    next(error);
  }
};

exports.deletePrivateData = async (req, res, next) => {
  try {
    const { key } = req.params;
    if (!isValidKey(key)) return res.status(400).json({ error: "Invalid data key" });

    await prisma.privateData.deleteMany({
      where: {
        userId: req.user.id,
        key,
      },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
