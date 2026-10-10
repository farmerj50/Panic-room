import type { NotifyResult } from '../services/emergencyService';

// Emergency TEXT outcome for the status panel. "Queued" means the provider
// accepted it — never claim delivery. Calls and recording are independent.
export function describeSmsResult(response: NotifyResult): string {
  if (response.smsAvailable === false) {
    return response.error === 'SMS_DISABLED'
      ? "Emergency texts aren't enabled yet — recording and calls continue."
      : 'SMS unavailable — recording and calls continue.';
  }
  const queued = response.queuedCount ?? response.notifiedCount ?? 0;
  const total = response.contactCount ?? queued;
  const ineligible = response.ineligibleCount ?? 0;
  const notEligible = ineligible > 0 ? ` · ${ineligible} not eligible for SMS alerts` : '';
  if (queued > 0) return `SMS queued for ${queued} of ${total} contact${total === 1 ? '' : 's'}${notEligible}`;
  if (response.error) return `Text failed: ${response.error}${notEligible}`;
  if ((response.eligibleCount ?? 0) === 0 && total > 0) {
    return `No contacts have accepted SMS alerts yet — send invites from Contacts. Calls are unaffected.`;
  }
  return 'No emergency texts were sent.';
}
