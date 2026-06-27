/** Signal categories for weekly cycle data collection. Maps to bb_types.signal_type. */
export const SignalType = {
  PLATFORM:    'PLATFORM',
  BEHAVIOURAL: 'BEHAVIOURAL',
  OUTCOME:     'OUTCOME',
  TEMPORAL:    'TEMPORAL',
} as const;
export type SignalType = typeof SignalType[keyof typeof SignalType];
