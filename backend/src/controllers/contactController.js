const prisma = require("../config/db");
const { decrypt, encrypt } = require("../services/cryptoService");

function serializeContact(contact) {
  return {
    id: contact.id,
    createdAt: contact.createdAt,
    name: decrypt(contact.name),
    phoneNumber: decrypt(contact.phoneNumber),
    isPriority: contact.isPriority,
  };
}

exports.createContact = async (req, res, next) => {
  try {
    const { name, phoneNumber } = req.body;
    const trimmedName = String(name || "").trim();
    const trimmedPhone = String(phoneNumber || "").trim();

    if (!trimmedName || !trimmedPhone) {
      return res.status(400).json({ error: "Name and phone number are required" });
    }

    const contact = await prisma.trustedContact.create({
      data: {
        userId: req.user.id,
        name: encrypt(trimmedName),
        phoneNumber: encrypt(trimmedPhone),
        isPriority: Boolean(req.body.isPriority),
      },
    });

    res.status(201).json(serializeContact(contact));
  } catch (error) {
    next(error);
  }
};

exports.getContacts = async (req, res, next) => {
  try {
    const contacts = await prisma.trustedContact.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
    });

    res.json(contacts.map(serializeContact));
  } catch (error) {
    next(error);
  }
};

exports.updateContact = async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = {};

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: "Name cannot be empty" });
      data.name = encrypt(name);
    }
    if (req.body.phoneNumber !== undefined) {
      const phoneNumber = String(req.body.phoneNumber).trim();
      if (!phoneNumber) return res.status(400).json({ error: "Phone number cannot be empty" });
      data.phoneNumber = encrypt(phoneNumber);
    }
    if (req.body.isPriority !== undefined) data.isPriority = Boolean(req.body.isPriority);

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "No supported contact fields provided" });
    }

    const existing = await prisma.trustedContact.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: "Contact not found" });

    const contact = await prisma.$transaction(async (tx) => {
      if (data.isPriority === true) {
        await tx.trustedContact.updateMany({
          where: { userId: req.user.id, id: { not: id } },
          data: { isPriority: false },
        });
      }

      return tx.trustedContact.update({
        where: { id },
        data,
      });
    });

    res.json(serializeContact(contact));
  } catch (error) {
    next(error);
  }
};

exports.deleteContact = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.trustedContact.findFirst({
      where: { id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: "Contact not found" });

    await prisma.trustedContact.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
