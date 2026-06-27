/**
 * Base class for domain value objects.
 *
 * Value objects have no identity. Equality is structural — two value objects
 * are equal if all their properties are deeply equal.
 * Value objects are immutable: no setters, no mutation after construction.
 *
 * Source: Repository Structure V1 Section 04, Domain Architecture V1 Chapter 03.
 */
export abstract class ValueObject {
  /**
   * Returns the properties that define equality for this value object.
   * Subclasses must implement this and return all discriminating fields.
   *
   * @example
   * protected getEqualityProperties() {
   *   return { priceTier: this.priceTier, availability: this.availability };
   * }
   */
  protected abstract getEqualityProperties(): Record<string, unknown>;

  /**
   * Two value objects are equal if they are the same type and all equality
   * properties are strictly equal (shallow comparison of the record).
   * For nested value objects, override this method.
   */
  equals(other: ValueObject): boolean {
    if (this.constructor !== other.constructor) return false;
    const a = this.getEqualityProperties();
    const b = other.getEqualityProperties();
    const keysA = Object.keys(a);
    if (keysA.length !== Object.keys(b).length) return false;
    return keysA.every((key) => a[key] === b[key]);
  }
}
