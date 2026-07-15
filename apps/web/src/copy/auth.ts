/**
 * Every founder-visible string for the magic-link sign-in surface, in one auditable place. Language
 * Blueprint: quiet, precise, non-persuasive. No unlock/maximize/complete/improve/AI-powered/recommended,
 * no urgency, no exclamation, no false claims. On a delivery failure we do NOT claim an email was sent.
 */
export const AUTH_COPY = {
  title: 'Business Brain',
  emailLabel: 'Email',
  submit: 'Send me a link',
  submitting: 'Sending…',
  // On 200: the request was accepted (the API never reveals whether an address exists).
  sentHeading: 'Check your email for the access link.',
  sentDetail: (email: string): string => `If ${email} can sign in, a link is on its way. Open it to continue.`,
  devLinkLabel: 'Dev link:',
  useDifferentEmail: 'Use a different email',
  // On a delivery failure (503): generic, no provider detail, no "sent" claim.
  sendFailed: "I couldn't send the access link. Try again.",
} as const;
