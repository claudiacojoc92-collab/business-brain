import { describe, it, expect } from 'vitest';
import { unbackedClaims, softenUnbackedClaims } from '../../arc/email-claims';

const e = (body: string, subject = 'Testnet date and runbook') => ({ subject, body });
const ctx = ['Two organisations asked twice for the testnet date and are waiting on it.'];

describe('email: no status the founder never confirmed', () => {
  it('flags a present claim of a confirmed date the founder never gave', () => {
    expect(unbackedClaims(e('We have a confirmed testnet date of [date] and we want…'), ctx)).toEqual(['We have a confirmed testnet date', 'a confirmed testnet date of']);
    expect(unbackedClaims(e('Good news. The testnet date is confirmed for [date].'), ctx)).toEqual(['The testnet date is confirmed']);
    expect(unbackedClaims(e('We now have a date for you.'), ctx)).toEqual(['We now have a date']);
  });
  it('lets targets and promises through ("once the date is confirmed", "the final date")', () => {
    expect(unbackedClaims(e('We are targeting [date], pending internal confirmation. We will confirm the date by [date].'), ctx)).toEqual([]);
    expect(unbackedClaims(e('We will book the session the moment the date is confirmed.'), ctx)).toEqual([]);
    expect(unbackedClaims(e('We will send you the final date by Friday. Once the testnet date is set, we call you.'), ctx)).toEqual([]);
  });
  it('licenses "confirmed" when the founder said it', () => {
    expect(unbackedClaims(e('We have a confirmed testnet date of 3 November.'), ['The testnet date is confirmed: 3 November.'])).toEqual([]);
  });
  it('softens only the claim shapes, keeping the sentence grammatical', () => {
    expect(softenUnbackedClaims(e('We have a confirmed testnet date of [date] and more.')).body).toBe('We have a target testnet date of [date] and more.');
    expect(softenUnbackedClaims(e('We now have a date for you.')).body).toBe('We are targeting a date for you.');
    expect(softenUnbackedClaims(e('The testnet date is confirmed for [date].')).body).toBe('The testnet date is planned for [date].');
    expect(softenUnbackedClaims(e('We call you once the date is confirmed.')).body).toBe('We call you once the date is confirmed.');
  });
});
