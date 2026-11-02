import { ArraySchema, Schema, type } from '@colyseus/schema';
import {
  INITIAL_PLAYER_RESOURCES,
  INITIAL_POPULATION_CAP,
  UNIT_UPGRADE_ORDER
} from '@chien-quoc/shared';

export class PlayerState extends Schema {
  @type('string') id: string = '';
  @type('string') name: string = 'Player';
  @type('string') color: string = '#3b82f6';
  @type('number') wood: number = INITIAL_PLAYER_RESOURCES.wood;
  @type('number') food: number = INITIAL_PLAYER_RESOURCES.food;
  @type('number') gold: number = INITIAL_PLAYER_RESOURCES.gold;
  @type('number') stone: number = INITIAL_PLAYER_RESOURCES.stone;
  @type('number') population: number = 0;
  @type('number') populationCap: number = INITIAL_POPULATION_CAP;
  @type('boolean') isOnline: boolean = true;
  /**
   * Research level per unit type, indexed by `UNIT_UPGRADE_ORDER`. Every entry
   * starts at 1; the server is the only writer.
   */
  @type(['number']) unitLevels = new ArraySchema<number>();
  /** Unit research timer; an empty type means nothing is being researched. */
  @type('string') researchUnitType: string = '';
  @type('number') researchProgressMs: number = 0;
  @type('number') researchTimeMs: number = 0;

  constructor() {
    super();
    for (let index = 0; index < UNIT_UPGRADE_ORDER.length; index++) {
      this.unitLevels.push(1);
    }
  }
}

