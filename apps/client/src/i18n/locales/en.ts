/** English catalog, key-aligned with the Vietnamese one. */
const en = {
  common: {
    language: 'Language'
  },
  app: {
    zoneKingdom: 'KINGDOM',
    zoneRaid: 'RAID',
    sessionExpired: 'Your session has expired. Please sign in again.',
    invalidSession: 'Invalid session. Please sign in again.',
    connectFailed: 'Could not connect to the game server. Check that it is running on port 2567!',
    sessionReplaced: 'This account was signed in on another device.',
    connectionLost: 'Lost connection to the server.',
    cannotSpectate: 'This kingdom cannot be watched right now.',
    switchToEnemyFailed: 'Could not enter the enemy kingdom. Your army is waiting; try again.',
    switchHomeFailed: 'Could not return home. Your army is safe; try again.',
    switchMapFailed: 'Could not switch maps. Please try again.',
    switchingMap: 'Switching maps...',
    switchingMapDetail: 'Loading the destination map.',
    reload: 'Reload page',
    retry: 'Retry',
    restoreSession: 'Restoring your session...',
    connectingWorld: 'Connecting to the world...',
    underAttack: 'Under attack!',
    disconnectTitle: 'DISCONNECTED',
    disconnectBody: 'The account {{name}} is still signed in. Reconnect to continue your empire and army.',
    reconnect: 'Reconnect',
    logout: 'Sign out',
    raidWinLoot: 'Victory! Looted {{wood}} wood, {{food}} food, {{gold}} gold and {{stone}} stone.',
    raidDefeat: 'The raiding army was defeated.',
    raidRetreated: 'The army has returned to the kingdom.'
  },
  auth: {
    title: 'CHIEN QUOC MMO RTS',
    subtitle: 'Build an empire, mine resources and unite the land in a 2.5D isometric world.',
    loginTab: 'Sign In',
    registerTab: 'Sign Up',
    username: 'Username',
    usernamePlaceholder: 'e.g. dai_viet',
    displayName: 'Lord name (shown in game)',
    displayNamePlaceholder: 'e.g. Dai_Viet',
    displayNameHint: 'The lord name may only contain letters, digits and underscores (_).',
    password: 'Password',
    passwordHint: 'At least 6 characters',
    unknownError: 'An unknown error occurred.',
    connecting: 'Connecting...',
    enterWorld: 'Enter the World',
    createEmpire: 'Create Empire',
    passwordEncrypted: 'Passwords are hashed with scrypt on the server.',
    touchHelp1: 'Drag with one finger to pan the camera, pinch with two to zoom in / out',
    touchHelp2: 'Tap to select units / buildings, tap empty ground to move',
    touchHelp3: 'Long-press a target to attack / gather / enter a gate',
    touchHelp4: 'The command bar below has Command, Attack, Patrol, Box Select and zoom',
    touchHelp5: 'Tap the minimap to jump the camera, long-press it to order units there',
    desktopHelp1: 'Arrow keys or moving the mouse to the screen edge pans the camera',
    desktopHelp2: 'Scroll the mouse wheel to zoom, + / - to zoom one step',
    desktopHelp3: 'Hold the middle mouse button and drag to pan the camera',
    desktopHelp4: 'Ctrl / Shift + F2..F4 saves a camera position, F2..F4 jumps back to it',
    desktopHelp5: 'Left click selects / box-selects units, right click orders movement & gathering',
    desktopHelp6: 'Ctrl + drag selects only soldiers, Alt + drag selects only villagers',
    desktopHelp7: 'Shift + click adds/removes units, Ctrl + click or double-click selects the same type',
    desktopHelp8: 'Shift + right click queues waypoints (hold Shift to see the path)',
    desktopHelp9: 'Select a building + right click to set a rally point for new soldiers',
    desktopHelp10: 'Right click the minimap to move there (left click pans the camera)',
    desktopHelp11: 'Ctrl + 1..9 assigns a group, 1..9 recalls it',
    desktopHelp12: 'S stops the selected units in place (cancels the current order)',
    desktopHelp13: 'D cycles stances: Aggressive → Defensive → Stand Ground → No Attack',
    desktopHelp14: '. jumps to an idle villager, Ctrl + . to an idle soldier, H returns to the Town Center',
    desktopHelp15: 'Delete / Backspace cancels the selected foundation (refunds resources), ✕ in the detail panel cancels the unit being trained'
  },
  hud: {
    wood: 'Wood',
    food: 'Food',
    gold: 'Gold',
    stone: 'Stone',
    population: 'Population',
    idleVillagers: 'Idle villagers',
    idleVillagersTitle: 'Idle villagers (key .)',
    woodTitle: 'Wood',
    foodTitle: 'Food',
    goldTitle: 'Gold',
    stoneTitle: 'Stone',
    populationTitle: 'Population',
    populationCapped: 'Population capped — build more houses',
    citadelLow: 'Citadel below the danger threshold',
    worldMap: 'World map',
    retreat: 'Retreat',
    logout: 'Sign out',
    underAttack: 'UNDER ATTACK',
    underAttackTitle: 'Under attack',
    online: 'ONLINE',
    offline: 'OFFLINE',
    emperor: 'Emperor'
  },
  build: {
    title: 'BUILD STRUCTURES',
    buildButton: 'Build',
    close: 'Close',
    cancel: 'Cancel (Esc)',
    cancelPlacement: 'Cancel placement',
    population: 'Population',
    road: 'Road',
    roadHint: 'Drag to paint roads. 2 wood per tile. Soldiers move 30% faster on roads.',
    erase: 'Erase',
    eraseHint: 'Drag to erase your roads. 100% wood is refunded if not yet built.',
    eraseWall: 'Erase wall',
    eraseWallHint: 'Drag to demolish your stone walls. Unfinished segments refund their cost.',
    lockedAtLevel: 'Requires Town Center Lv {{level}}'
  },
  placement: {
    placing: 'Placing {{name}}',
    hint: 'Tap the ground to build · press Cancel to exit',
    road: 'Painting roads',
    roadHint: 'Drag to paint · right-click or Cancel to exit',
    wall: 'Building a wall',
    wallHint: 'Drag to build the wall · right-click or Cancel to exit',
    wallErase: 'Erasing a wall',
    wallEraseHint: 'Drag to erase the wall · right-click or Cancel to exit',
    insufficient: 'Not enough resources',
    stock: 'In stock: {{amount}}',
    cancel: 'Cancel',
    cancelTitle: 'Cancel placement (Esc)'
  },
  resources: {
    wood: 'Wood',
    food: 'Food',
    gold: 'Gold',
    stone: 'Stone'
  },
  details: {
    hp: 'Hit points (HP)',
    level: 'Lv {{level}}{{max}}',
    stance: 'Stance',
    carrying: 'Carrying',
    remaining: 'Remaining:',
    underConstruction: 'Under construction',
    cancelBuilding: 'Cancel building (Delete)',
    cancelBuildingTitle: 'Cancel the foundation and refund part of the cost',
    deleteBuilding: 'Delete building (Delete)',
    deleteBuildingTitle: 'Demolish this building (no refund)',
    trainingTitle: 'TRAIN ARMY',
    queue: 'Queued: {{count}}',
    cancelTrainTitle: 'Cancel the unit being trained and refund its full cost',
    attack: 'Attack: {{value}}',
    hpStat: 'HP: {{value}}',
    currentLevel: 'Current level: {{level}}/{{max}}',
    trainTime: 'Training: {{seconds}}s',
    hotkey: 'Hotkey: {{key}}',
    unitPower: 'COMBAT STATS',
    attackPower: 'Attack',
    attackRange: 'Range',
    cooldown: 'Cooldown',
    speed: 'Speed',
    retreatGate: 'RETREAT GATE',
    retreatAll: 'Withdraw the whole army to the kingdom',
    retreatHintTouch: 'Long-press the gate to retreat.',
    retreatHintMouse: 'Right click the gate to retreat.',
    harvestFarmTouch: 'Long-press a villager onto the farm to harvest; an exhausted farm is re-sown with wood.',
    harvestMineTouch: 'Long-press a villager onto the mine to gather.',
    harvestFarmMouse: 'Right click a villager onto the farm to harvest; an exhausted farm is re-sown with wood.',
    harvestMineMouse: 'Right click a villager onto the mine to gather.',
    roadUnderConstruction: 'Road (under construction)',
    empireBuff: 'EMPIRE BUFF · TOWN CENTER LV {{level}}',
    trainerEffectHeader: 'TRAINING BUILDING EFFECT · LV {{level}}',
    campEffectHeader: 'CAMP EFFECT · LV {{level}}'
  },
  stats: {
    buildingUnitHp: 'Building & unit HP',
    unitAttack: 'Unit attack',
    trainingTime: 'Training time',
    unitHpAttack: 'Unit HP & attack',
    gatherSpeed: 'Gather rate',
    unloadRadius: 'Unload radius'
  },
  entityType: {
    unit: 'unit',
    building: 'building',
    resource: 'resource'
  },
  stances: {
    AGGRESSIVE: 'Aggressive',
    DEFENSIVE: 'Defensive',
    STAND_GROUND: 'Stand Ground',
    NO_ATTACK: 'No Attack'
  },
  resourceNodes: {
    TREE: 'Wood tree',
    GOLD_MINE: 'Gold mine',
    STONE_MINE: 'Stone mine',
    BERRY: 'Berry bush'
  },
  upgrades: {
    buildingTitle: 'UPGRADE BUILDING',
    slotTitle: 'Each player can upgrade at most {{count}} buildings at once',
    slot: 'Slot {{used}}/{{max}}',
    visualTierTitle: 'The building shape changes with its level',
    visual: 'Shape {{tier}}/{{count}} · {{name}}',
    changesAt: 'changes at Lv {{level}}',
    requiresCore: 'Core buildings require Lv {{level}}',
    upgrading: 'Upgrading',
    cancel: 'Cancel upgrade (refund)',
    cancelTitle: 'Cancel the upgrade, refund everything and free the slot',
    maxed: 'Already at max level.',
    slotsFull: 'All {{count}} upgrade slots are in use',
    requiresCoreFirst: 'Upgrade the core buildings first',
    requiresCoreFirstShort: 'Core buildings must reach the required level before upgrading the Town Center',
    insufficient: 'Not enough resources',
    upgradeTo: 'Upgrade to Lv {{level}}',
    researchTitle: 'ARMY RESEARCH',
    global: 'Global',
    cancelResearch: 'Cancel the research and refund its full cost',
    max: 'Max',
    researching: 'Researching',
    upgradeLevel: 'Upgrade Lv {{level}}',
    currentBuff: 'Current buff',
    afterUpgrade: 'After upgrade',
    barracksEffect: 'Barracks effect',
    campEffect: 'Camp effect'
  },
  houseTiers: {
    '1': 'Thatched Hut',
    '2': 'Timber Cottage',
    '3': 'Stone Cottage',
    '4': 'Town House',
    '5': 'Manor'
  },
  worldMap: {
    title: 'WORLD MAP',
    subtitle: 'Empires within 5 Town Center levels of yours · You are level {{level}}',
    refresh: 'Refresh',
    close: 'Close map',
    aria: 'Map of neighbouring empires',
    you: 'You',
    selfTile: 'You · Lv {{level}}',
    legendWeaker: 'Weaker',
    legendEqual: 'Same level',
    legendStronger: 'Stronger',
    legendDelta: '−N weaker · = equal · +N stronger',
    pick: 'Pick a tile on the map to see that empire.',
    townCenter: 'Town Center',
    level: 'Level {{level}}',
    delta: 'Difference',
    remaining: '· {{time}} left',
    army: 'Army',
    selectArmy: 'Select units on the main map, then open this map again.',
    attack: 'Raid',
    attacking: 'Sending army...',
    spectate: 'Spectate',
    opening: 'Opening...',
    minutes: '{{count}} min',
    hours: '{{count}} hr',
    days: '{{count}} days',
    daysHours: '{{days}} days {{hours}} hr'
  },
  minimap: {
    map: 'Map',
    kingdom: 'KINGDOM',
    battlefield: 'BATTLEFIELD',
    close: 'Close',
    closeMap: 'Close map',
    hint: 'Tap: jump · Long-press: order units',
    title: 'MAP · {{zone}}'
  },
  session: {
    title: 'ACCOUNT ALREADY SIGNED IN',
    body: 'This account is running an empire in another tab or device. Each account may only have one play session at a time.',
    takeover: 'Sign out the other device & play',
    otherAccount: 'Sign in with another account',
    note: 'The other session will be disconnected if you take over.'
  },
  spectator: {
    title: 'SPECTATING · {{name}}',
    level: 'Town Center level {{level}} · Read-only, commands are disabled',
    close: 'Close spectator window',
    loading: 'Opening the kingdom...'
  },
  controlGroups: {
    title: 'UNIT GROUPS',
    VILLAGER: 'Vill',
    SPEARMAN: 'Spear',
    ARCHER: 'Arch',
    CAVALRY: 'Cav'
  },
  mobile: {
    cancelOrder: 'Cancel',
    cancelOrderTitle: 'Cancel the pending order',
    command: 'Command',
    commandTitle: 'Tap a target: attack / gather / enter gate / move',
    attack: 'Attack',
    attackTitle: 'Attack-move',
    patrol: 'Patrol',
    patrolTitle: 'Patrol to the tapped point',
    stop: 'Stop',
    stopTitle: 'Stop the current order',
    stance: 'Stance',
    stanceTitle: 'Cycle stance (aggressive / defensive / stand ground / no attack)',
    boxSelect: 'Box select',
    boxSelectTitle: 'Arm it, then drag once to select several units',
    clear: 'Deselect',
    clearTitle: 'Clear the selection',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    home: 'Town Center',
    homeTitle: 'Go to the Town Center'
  },
  orientation: {
    title: 'ROTATE YOUR DEVICE',
    body: 'Chien Quoc needs a landscape screen to show the map, minimap and command bar at the same time.'
  },
  buildings: {
    TOWN_CENTER: {
      name: 'Town Center',
      description: 'The heart of your settlement. Trains villagers and provides core population.'
    },
    BARRACKS: {
      name: 'Barracks',
      description: 'Infantry barracks. Recruits spearmen, the backbone of a melee army.'
    },
    STABLE: {
      name: 'Stable',
      description: 'Cavalry stable. Breeds and trains mounted warriors for fast raids.'
    },
    ARCHERY_RANGE: {
      name: 'Archery Range',
      description: 'Archery range. Trains archers who fight from behind the front line.'
    },
    SIEGE_WORKSHOP: {
      name: 'Siege Workshop',
      description: 'Siege workshop. A fortified yard prepared for siege-engine production.'
    },
    HOUSE: {
      name: 'House',
      description: 'Provides housing to support up to 5 additional population.'
    },
    FARM: {
      name: 'Farm',
      description: 'Renewable source of food. Villagers harvest it in place and re-sow it when it runs dry.'
    },
    TOWER: {
      name: 'Watch Tower',
      description: 'Defensive structure that fires arrows at approaching enemy forces.'
    },
    WALL: {
      name: 'Stone Wall',
      description: 'A stone wall segment. Blocks movement and can be destroyed to open a breach.'
    },
    LUMBER_CAMP: {
      name: 'Lumber Camp',
      description: 'Wood drop-off. Villagers haul logs here instead of walking back to the Town Center.'
    },
    MILL: {
      name: 'Mill',
      description: 'Food drop-off. Berries and farm harvests are delivered here.'
    },
    MINING_CAMP: {
      name: 'Mining Camp',
      description: 'Gold and stone drop-off. Serves both mine types from one spot.'
    },
    PORTAL: {
      name: 'Portal',
      description: 'Gateway between your kingdom and the shared battlefield.'
    }
  },
  units: {
    VILLAGER: {
      name: 'Villager',
      description: 'Gathers resources and constructs buildings for your empire.'
    },
    SPEARMAN: {
      name: 'Spearman',
      description: 'Infantry unit equipped with spears, excellent against cavalry.'
    },
    ARCHER: {
      name: 'Archer',
      description: 'Ranged unit capable of firing arrows from distance.'
    },
    CAVALRY: {
      name: 'Cavalry',
      description: 'Fast and powerful mounted warrior suited for hit-and-run tactics.'
    }
  }
};

export default en;
