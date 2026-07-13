import { emptyCopy } from './styles';

/**
 * A quiet, honest empty state for a section. It states what the section IS, without sounding like missing
 * functionality, a coming-soon promise, or pressure on the founder to create content. No CTA.
 */
export function EmptySectionState({ copy }: { copy: string }) {
  return <p style={emptyCopy}>{copy}</p>;
}
