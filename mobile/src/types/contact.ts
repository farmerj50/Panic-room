// Whether a trusted contact can receive emergency TEXT alerts (calls are not
// affected). Only 'accepted' contacts are texted; see backend
// smsEligibilityService.
export type ContactSmsStatus = 'accepted' | 'pending' | 'declined' | 'revoked' | 'opted_out' | 'number_changed';

export interface Contact {
  id: string;
  name: string;
  phoneNumber: string;
  isPriority: boolean;
  smsStatus?: ContactSmsStatus;
}
