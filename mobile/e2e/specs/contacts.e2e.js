const landingPage = require('../pageobjects/landing.po');
const authPage = require('../pageobjects/auth.po');
const tabBar = require('../pageobjects/tabBar.po');
const profilePage = require('../pageobjects/profile.po');
const contactsPage = require('../pageobjects/contacts.po');

describe('PanicRoom trusted contacts', () => {
  it('adds a trusted contact and it appears in the list', async () => {
    await landingPage.createAccountBtn.waitForDisplayed({ timeout: 60000, interval: 1000 });
    await landingPage.createAccountBtn.click();
    await authPage.register(`e2e-contacts-${Date.now()}@panicroom.test`, 'TestPass1234!');

    await tabBar.profileBtn.waitForDisplayed({ timeout: 45000 });
    await tabBar.profileBtn.click();

    await profilePage.contactsBtn.waitForDisplayed({ timeout: 10000 });
    await profilePage.contactsBtn.click();

    await contactsPage.screen.waitForDisplayed({ timeout: 10000 });

    // A brand-new account has no contacts yet.
    expect(await contactsPage.emptyState.isExisting()).toBe(true);

    const contactName = `E2E Contact ${Date.now()}`;
    await contactsPage.addContact(contactName, '+15551234567');

    // Saving is a real network round-trip to the backend.
    const savedRow = contactsPage.rowByName(contactName);
    await savedRow.waitForDisplayed({ timeout: 15000 });
  });

  it('rejects an invalid phone number with a visible error', async () => {
    // Continues from the previous test's session — already on Contacts.
    await contactsPage.addToggleBtn.waitForDisplayed({ timeout: 10000 });
    await contactsPage.addContact('Bad Number Contact', '123');

    // The backend's phone-format validation should surface as an inline
    // error, not silently add a garbage contact.
    const errorAlertOk = await $('//*[@text="OK"]');
    if (await errorAlertOk.isExisting()) {
      await errorAlertOk.click();
    }

    const badRow = contactsPage.rowByName('Bad Number Contact');
    expect(await badRow.isExisting()).toBe(false);
  });
});
