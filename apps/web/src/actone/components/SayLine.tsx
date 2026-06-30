import type { Rich } from '../types';
import { RichText } from './rich';
import styles from '../actone.module.css';

/** A single line in Business Brain's voice. Settles in via CSS (no bounce). */
export function SayLine({ rich, kind = 'med' }: { rich: Rich; kind?: 'big' | 'med' | 'admit' }) {
  return (
    <div className={`${styles.say} ${styles[kind]}`}>
      <RichText text={rich} />
    </div>
  );
}
