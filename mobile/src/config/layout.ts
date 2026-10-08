// Shared page-width cap, matching the convention the app's other list/form
// screens already use (Setup, Covert Messaging, Contacts: 620px, centered).
// On phones (< 620px) this changes nothing; on the web build in a wide
// desktop window it keeps headers and content in a centered column instead
// of stretching edge to edge. Not for the live Emergency screen, camera, or
// map — those keep their own safety-first layout.
export const CONTENT_MAX_WIDTH = 620;

export const contentColumn = {
  alignSelf: 'center',
  maxWidth: CONTENT_MAX_WIDTH,
  width: '100%',
} as const;
