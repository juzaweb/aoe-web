/**
 * Which room is currently allowed to write a zone.
 *
 * Colyseus removes an empty room from the matchmaker cache before its
 * `onDispose` finishes. A join in that ~1s window can therefore create a second
 * room for the same zone while the first is still flushing. The token makes the
 * newest room the only writer: a stale `onDispose` silently skips its save
 * instead of overwriting the new room's snapshot.
 */
class ZonePersistenceRegistry {
  private readonly owners = new Map<string, number>();
  private sequence = 0;

  claim(zone: string): number {
    const token = ++this.sequence;
    this.owners.set(zone, token);
    return token;
  }

  isCurrent(zone: string, token: number): boolean {
    return this.owners.get(zone) === token;
  }

  release(zone: string, token: number): void {
    if (this.isCurrent(zone, token)) this.owners.delete(zone);
  }

  reset(): void {
    this.owners.clear();
  }
}

export const zonePersistence = new ZonePersistenceRegistry();
