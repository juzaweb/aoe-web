/**
 * Process-wide entity id sequence.
 *
 * Entity ids are primary keys in SQLite, but each Colyseus room used to keep its
 * own counter starting at 1000. Once the world is split into a per-account
 * kingdom room and one shared battlefield room, those counters would mint the
 * same `b_1001` on both maps and the second upsert would overwrite the first
 * row. One allocator for the whole process makes ids unique across zones without
 * changing their shape (`b_<n>`, `u_<n>`, `res_<n>`).
 */
export class EntityIdAllocator {
  private next = 1000;

  /** Advances past an id already present in the database or in memory. */
  observe(id: string): void {
    const match = /(\d+)$/.exec(id);
    if (!match) return;

    const value = Number(match[1]);
    if (Number.isFinite(value) && value > this.next) {
      this.next = value;
    }
  }

  /** Reserve the next id. Callers add their own type prefix. */
  nextId(): number {
    return ++this.next;
  }

  /** Test/seed hook; production never rewinds the sequence. */
  reset(seed = 1000): void {
    this.next = seed;
  }
}

export const entityIds = new EntityIdAllocator();
