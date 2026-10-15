import { describe, it, expect } from 'vitest';
import { weekToday } from '../slice0/ArcSurface';

// BUS-82: the Day One week shows the canonical Today the server selected, never a story told for another move.
const story = { planVersionId: 'p', context: '', statement: '', whyNow: '', chapters: [], today: { move: 'Scrie-le celor doi medici.', detail: 'd' }, doneLooksLike: 'x' };
describe('weekToday', () => {
  it('a canonical plan move uses the story\'s re-told sentence', () => {
    expect(weekToday({ week: [], today: 'Write to two orthopaedic doctors', canCreate: false, todayKind: 'plan', story })).toEqual({ move: 'Scrie-le celor doi medici.', fromStory: true });
  });
  it('a due follow-up is shown as is (the story is about a plan move)', () => {
    expect(weekToday({ week: [], today: 'Trimite broșura pe email (Spitalul Clinic)', canCreate: false, todayKind: 'follow_up', story })).toEqual({ move: 'Trimite broșura pe email (Spitalul Clinic)', fromStory: false });
  });
  it('no story → the canonical move text', () => {
    expect(weekToday({ week: [], today: 'Write to two doctors', canCreate: false, todayKind: 'plan', story: null })).toEqual({ move: 'Write to two doctors', fromStory: false });
  });
});
