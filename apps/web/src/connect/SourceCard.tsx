import type { ReactNode } from 'react';
import { card, cardTitle } from './styles';

/** A quiet bordered source block — an <h2> title + its connect body. Not a KPI tile. */
export function SourceCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={card}>
      <h2 style={cardTitle}>{title}</h2>
      {children}
    </section>
  );
}
