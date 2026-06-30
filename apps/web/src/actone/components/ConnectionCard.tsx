import styles from '../actone.module.css';

/** One connectable source (presentational; selection state owned by ConnectionPanel). */
export function ConnectionCard({
  name,
  on,
  onToggle,
}: {
  name: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`${styles.src} ${on ? styles.srcOn : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={on}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
    >
      <div className={styles.srcDot} />
      <div className={styles.srcName}>{name}</div>
    </div>
  );
}
