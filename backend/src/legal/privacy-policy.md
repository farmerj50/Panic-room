<!--
  DRAFT — NOT LEGAL ADVICE. Attorney review required before publishing.

  This document was drafted by an AI assistant based on a technical review of
  the Bes codebase (as of this draft's date). It accurately describes what
  the app's code actually does with data as of this writing, but it has NOT
  been reviewed by a lawyer, and it does not account for:
    - State/federal law specific to domestic-violence-support services
      (several states have heightened confidentiality protections for DV
      shelters/hotlines/advocates — verify whether any apply to this app).
    - App store requirements (Apple/Google) beyond the general shape of a
      privacy policy — review each store's current requirements directly.
    - Any future changes to the app's data handling that aren't reflected
      here — this document must be updated whenever data practices change.

  Placeholders in [BRACKETS] must be filled in before this is usable.
-->

# Privacy Policy

**Last updated: August 3, 2026**

This Privacy Policy describes how Bes ("Bes," "we," "us," or "our") collects,
uses, and protects information when you use the Bes mobile application and
related services (the "Service").

Bes is a personal safety application. Please read the separate **Terms of
Service**, especially the safety disclaimer, before relying on the Service in
an emergency.

## 1. Information We Collect

### Account information
- **Email address** — used to sign in and for account recovery. Stored
  encrypted; a separate one-way hash is kept only to check for duplicate
  accounts, not to recover the address.
- **Name** (optional) — stored encrypted.
- **Password** — never stored in plain text. We store only a salted
  cryptographic hash (bcrypt) and cannot recover your original password.
- **Phone number** (optional) — only if you choose to enable Covert
  Messaging (see below). Stored encrypted, with a separate one-way hash used
  only to match you against a trusted contact's saved number.

### Trusted contacts
- Names and phone numbers of contacts you add are stored encrypted. A
  one-way hash of each phone number is also stored so the Service can
  privately check whether that contact also uses Bes, without either of you
  learning anything else about each other's account.

### Emergency events
- **Location (GPS coordinates)** captured when you activate an emergency,
  stored encrypted.
- **Audio and video recordings** captured during an emergency, uploaded to
  our storage and retrievable only via short-lived, single-purpose links
  generated for your account.
- **Notification status** — whether we attempted to alert your trusted
  contacts, and whether that attempt succeeded, partially succeeded, or
  failed.

### Covert Messaging
- Messages you send through Covert Messaging are encrypted on your device
  before we ever see them, using a key pair generated and stored on your
  device. **We cannot read the contents of your covert messages, and we do
  not have access to the private key needed to decrypt them.** We store only
  the resulting encrypted image file and metadata about who it was sent to
  and when.
- Your public encryption key (not secret on its own) is stored so contacts
  can send you encrypted messages.

### Automatically collected information
- Basic technical data needed to operate the Service (e.g., session tokens,
  request timestamps, IP address as part of standard server logs).

## 2. How We Use Information

We use the information above to:
- Operate your account and trusted-contact list.
- Attempt to notify your trusted contacts and, where configured, place a
  voice call, when you activate an emergency.
- Store and let you review evidence (recordings, location, timestamps) from
  past emergency events.
- Enable Covert Messaging between you and your trusted contacts.
- Maintain the security of the Service (e.g., detecting compromised
  sessions and revoking them).

We do not sell your information, and we do not use it for advertising.

## 3. How We Protect Information

- Sensitive fields (email, name, phone number, location, recording
  locations) are encrypted at rest using AES-256-GCM.
- Passwords are hashed with bcrypt and never stored or transmitted in plain
  text.
- Covert messages are end-to-end encrypted (X25519 key exchange with
  XSalsa20-Poly1305 authenticated encryption) — encryption and decryption
  happen only on your device and the recipient's device.
- Sessions use short-lived access tokens and rotating refresh tokens; a
  stolen or reused refresh token causes all of your active sessions to be
  revoked.
- Data in transit is protected with industry-standard transport encryption
  (HTTPS/TLS).

No method of storage or transmission is 100% secure, and we cannot
guarantee absolute security.

## 4. Third Parties We Share Information With

- **Twilio** — when you activate an emergency and contact notification is
  enabled, your trusted contacts' phone numbers and a notification message
  (including, if available, your location) are sent through Twilio's SMS
  and voice-calling infrastructure to reach them. Twilio's handling of that
  data is governed by [Twilio's own privacy policy](https://www.twilio.com/legal/privacy).
- **Hosting/infrastructure providers** — our backend and file storage run on
  [Railway](https://railway.app) (or successor infrastructure), which
  processes data on our behalf under its own terms.

We do not share your information with any other third party except as
required by law or with your explicit direction.

## 5. Data Retention

We retain your account and emergency-event data for as long as your account
is active. You may request deletion of your account and associated data at
any time (see Section 7). [ADD: any specific retention period you intend to
enforce, e.g. "recordings older than X days are automatically deleted."]

## 6. Your Rights and Choices

- **Access and correction** — you can view and update your name, trusted
  contacts, and phone number directly in the app.
- **Deletion** — you can permanently delete your account and all associated
  data (trusted contacts, emergency history, recordings, and covert
  messages) at any time from Profile → Delete Account, after confirming
  your password. This immediately and permanently removes your data; it
  cannot be undone or recovered by us. You can also reach us at
  **johnfarmer43@gmail.com** with deletion questions.
- **Regeneration of your encryption key** — you can generate a new Covert
  Messaging key pair from your profile at any time; this does not delete
  messages already sent or received.

If you are located in a jurisdiction with statutory privacy rights (e.g.,
GDPR, CCPA), you may have additional rights; contact us at the address above
to exercise them. [Attorney should confirm which regimes actually apply
based on where you operate and where your users are located.]

## 7. Children's Privacy

Bes is not directed to children under 13, and we do not knowingly collect
information from children under 13. [Attorney should confirm the correct
minimum age given the app's target audience and any state-specific rules
for safety/support services used by minors.]

## 8. Emergency Feature Limitations

Please review the Terms of Service for important limitations on the
emergency-notification, recording, and Covert Messaging features. In
particular: **Bes is not a substitute for calling 911 or your local
emergency number, and delivery of alerts to your trusted contacts is not
guaranteed.**

## 9. Changes to This Policy

We may update this Privacy Policy from time to time. Material changes will
be reflected by updating the "Last updated" date above, and, where
appropriate, through an in-app notice.

## 10. Contact Us

Questions about this Privacy Policy or your data can be sent to:
**johnfarmer43@gmail.com**
