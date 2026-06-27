/** Represents a successful result. */
export class Ok<T> {
  readonly isOk = true as const;
  readonly isErr = false as const;
  constructor(readonly value: T) {}
}

/** Represents a failed result. */
export class Err<E> {
  readonly isOk = false as const;
  readonly isErr = true as const;
  constructor(readonly error: E) {}
}

/** A value that is either Ok<T> or Err<E>. */
export type Result<T, E> = Ok<T> | Err<E>;

/** Construct a successful Result. Preferred over `new Ok(value)`. */
export function ok<T>(value: T): Ok<T> {
  return new Ok(value);
}

/** Construct a failed Result. Preferred over `new Err(error)`. */
export function err<E>(error: E): Err<E> {
  return new Err(error);
}
