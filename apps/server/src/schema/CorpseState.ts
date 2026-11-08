import { Schema, type } from '@colyseus/schema';

/**
 * A unit that has just died, kept in the state long enough for clients to play
 * its death clip once.
 *
 * This is deliberately *not* a `UnitState` with a `DEAD` action state: a corpse
 * is not a combatant, not selectable, not counted for population and not
 * harvestable, and every system that walks `state.units` would need a guard to
 * say so. Keeping corpses in their own collection leaves the simulation
 * untouched - the unit is removed from `units` the moment it dies, exactly as
 * before.
 *
 * The room deletes the entry after a fixed linger; clients drop the sprite when
 * that happens, so nothing here needs a timestamp.
 */
export class CorpseState extends Schema {
  @type('string') id: string = '';
  /** Unit type the client resolves its death sheet from. */
  @type('string') unitType: string = 'VILLAGER';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  /** WALL: keep a body that fell on the wall top lifted off the courtyard. */
  @type('boolean') onWall: boolean = false;
}
