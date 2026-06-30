import type { Rich } from '../types';
import { TIMING } from '../fixtures';
import styles from '../actone.module.css';

/** Inline rich text → text / <em> / <strong>, no dangerouslySetInnerHTML. */
export function RichText({ text }: { text: Rich }) {
  return (
    <>
      {text.map((seg, i) =>
        typeof seg === 'string' ? (
          <span key={i}>{seg}</span>
        ) : 'em' in seg ? (
          <em key={i}>{seg.em}</em>
        ) : (
          <strong key={i}>{seg.b}</strong>
        ),
      )}
    </>
  );
}

interface Word { t: string; em: boolean; space: boolean }

/** Word-by-word compose (the Seeing observation): each word blurs/fades in on a stagger. */
export function ComposedText({ text }: { text: Rich }) {
  const words: Word[] = [];
  text.forEach((seg) => {
    const em = typeof seg !== 'string' && 'em' in seg;
    const str = typeof seg === 'string' ? seg : 'em' in seg ? seg.em : seg.b;
    str.split(/(\s+)/).forEach((tok) => {
      if (tok === '') return;
      words.push({ t: tok, em, space: tok.trim() === '' });
    });
  });
  let order = 0;
  return (
    <>
      {words.map((w, i) => {
        if (w.space) return <span key={i}>{w.t}</span>;
        const delay = order++ * TIMING.word;
        const style = { animationDelay: `${delay}ms` };
        return w.em ? (
          <em key={i} className={styles.word} style={style}>{w.t}</em>
        ) : (
          <span key={i} className={styles.word} style={style}>{w.t}</span>
        );
      })}
    </>
  );
}

/** Total time (ms) for a ComposedText of the given Rich to finish animating in. */
export function composeDuration(text: Rich): number {
  let n = 0;
  text.forEach((seg) => {
    const str = typeof seg === 'string' ? seg : 'em' in seg ? seg.em : seg.b;
    str.split(/(\s+)/).forEach((tok) => { if (tok.trim() !== '') n++; });
  });
  return n * TIMING.word + 420; // + one word animation
}
