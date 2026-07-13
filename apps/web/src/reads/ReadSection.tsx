import type { ReactNode } from 'react';
import { sectionTitle } from './styles';

/**
 * A section frame in the continuous vertical document: a semantic <section> with an <h2> title and its
 * content beneath. It carries NO rank, stakes, priority, severity, or urgency field — attention direction
 * is not this surface's job. Order is fixed by the caller (never reordered here).
 */
export function ReadSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ margin: '0 0 52px' }}>
      <h2 style={sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}
