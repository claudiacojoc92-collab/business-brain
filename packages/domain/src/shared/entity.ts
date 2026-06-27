/**
 * Base class for domain entities.
 *
 * Entities have identity (id) and are compared by id, not by value.
 * Unlike aggregates, entities do not maintain an event buffer.
 * They are owned by an aggregate and never cross aggregate boundaries.
 *
 * Source: Repository Structure V1 Section 04, Domain Architecture V1 Chapter 03.
 */
export abstract class Entity {
  constructor(readonly id: string) {}

  /**
   * Two entities are equal if and only if their ids are identical.
   */
  equals(other: Entity): boolean {
    return this.constructor === other.constructor && this.id === other.id;
  }
}
