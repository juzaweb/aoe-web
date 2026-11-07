/**
 * Vietnamese catalog. Keys are grouped by screen so a missing translation is
 * easy to spot next to the component that renders it.
 */
const vi = {
  common: {
    language: 'Ngôn ngữ'
  },
  app: {
    zoneKingdom: 'VƯƠNG QUỐC',
    zoneRaid: 'TẬP KÍCH',
    sessionExpired: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    invalidSession: 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.',
    connectFailed: 'Không thể kết nối đến máy chủ game. Hãy kiểm tra server đã chạy ở port 2567!',
    sessionReplaced: 'Phiên đã được đăng nhập ở thiết bị khác.',
    connectionLost: 'Mất kết nối với máy chủ.',
    cannotSpectate: 'Không thể quan sát vương quốc này.',
    switchToEnemyFailed: 'Không thể vào vương quốc địch. Quân của bạn đang chờ; hãy thử lại.',
    switchHomeFailed: 'Không thể về vương quốc. Quân của bạn đã được giữ an toàn; hãy thử lại.',
    switchMapFailed: 'Không thể chuyển bản đồ. Vui lòng thử lại.',
    switchingMap: 'Đang chuyển bản đồ...',
    switchingMapDetail: 'Bản đồ đích đang được tải.',
    reload: 'Tải lại trang',
    retry: 'Thử lại',
    restoreSession: 'Đang khôi phục phiên đăng nhập...',
    connectingWorld: 'Đang kết nối vào thế giới...',
    underAttack: 'Đang bị tấn công!',
    disconnectTitle: 'MẤT KẾT NỐI',
    disconnectBody: 'Tài khoản {{name}} vẫn đang đăng nhập. Kết nối lại để tiếp tục đế chế và quân đang chơi.',
    reconnect: 'Kết nối lại',
    logout: 'Đăng xuất',
    raidWinLoot: 'Thắng trận! Cướp được {{wood}} gỗ, {{food}} lương, {{gold}} vàng, {{stone}} đá.',
    raidDefeat: 'Quân tập kích đã bị đánh bại.',
    raidRetreated: 'Đã rút quân về vương quốc.'
  },
  auth: {
    title: 'CHIẾN QUỐC MMO RTS',
    subtitle: 'Xây dựng đế chế, khai khoáng và thống nhất thiên hạ trong thế giới 2.5D Isometric.',
    loginTab: 'Đăng Nhập',
    registerTab: 'Đăng Ký',
    username: 'Tên đăng nhập',
    usernamePlaceholder: 'vd: dai_viet',
    displayName: 'Tên lãnh chúa (hiển thị trong game)',
    displayNamePlaceholder: 'vd: Dai_Viet',
    displayNameHint: 'Tên lãnh chúa chỉ gồm chữ cái, số và dấu gạch dưới (_).',
    password: 'Mật khẩu',
    passwordHint: 'Tối thiểu 6 ký tự',
    unknownError: 'Đã xảy ra lỗi không xác định.',
    connecting: 'Đang kết nối...',
    enterWorld: 'Vào Thế Giới',
    createEmpire: 'Tạo Đế Chế',
    passwordEncrypted: 'Mật khẩu được mã hoá bằng scrypt trên máy chủ.',
    touchHelp1: 'Kéo 1 ngón để di chuyển camera, chụm 2 ngón để phóng to / thu nhỏ',
    touchHelp2: 'Chạm để chọn quân / công trình, chạm nền trống để đi tới',
    touchHelp3: 'Giữ lâu vào mục tiêu để đánh / khai thác / vào cổng',
    touchHelp4: 'Thanh lệnh dưới màn hình có Ra lệnh, Đánh, Tuần tra, Chọn vùng và zoom',
    touchHelp5: 'Chạm minimap để nhảy camera, giữ lâu trên minimap để điều quân tới đó',
    desktopHelp1: 'Phím mũi tên hoặc rê chuột ra mép màn hình để di chuyển camera',
    desktopHelp2: 'Cuộn Chuột để phóng to/thu nhỏ, + / - để zoom từng nấc',
    desktopHelp3: 'Giữ Chuột giữa và kéo để di chuyển camera',
    desktopHelp4: 'Ctrl / Shift + F2..F4 lưu vị trí camera, F2..F4 nhảy về vị trí đã lưu',
    desktopHelp5: 'Chuột trái chọn / quét quân, Chuột phải điều quân & khai thác',
    desktopHelp6: 'Ctrl + kéo chỉ quét lính, Alt + kéo chỉ quét nông dân',
    desktopHelp7: 'Shift + click để cộng/bớt quân, Ctrl + click hoặc double-click chọn cùng loại',
    desktopHelp8: 'Shift + Chuột phải xếp nhiều điểm đến liên tiếp (giữ Shift để xem đường đi)',
    desktopHelp9: 'Chọn công trình + Chuột phải đặt điểm tập kết (rally) cho lính mới',
    desktopHelp10: 'Chuột phải trên minimap ra lệnh di chuyển tới đúng chỗ đó (chuột trái để pan camera)',
    desktopHelp11: 'Ctrl + 1..9 gán nhóm, 1..9 gọi lại nhóm',
    desktopHelp12: 'S dừng quân đang chọn tại chỗ (huỷ lệnh hiện tại)',
    desktopHelp13: 'D đổi thế trận: Chủ động → Phòng thủ → Cố thủ → Không đánh',
    desktopHelp14: '. nhảy tới nông dân đang rảnh, Ctrl + . nhảy tới lính đang rảnh, H về Town Center',
    desktopHelp15: 'Delete / Backspace huỷ móng nhà đang chọn (hoàn lại tài nguyên), ✕ trong bảng chi tiết huỷ đơn vị đang huấn luyện'
  },
  hud: {
    wood: 'Gỗ',
    food: 'Lương thực',
    gold: 'Vàng',
    stone: 'Đá',
    population: 'Dân số',
    idleVillagers: 'Nông dân đang rảnh',
    idleVillagersTitle: 'Nông dân đang rảnh (phím .)',
    woodTitle: 'Gỗ (Wood)',
    foodTitle: 'Thực lương (Food)',
    goldTitle: 'Vàng (Gold)',
    stoneTitle: 'Đá (Stone)',
    populationTitle: 'Dân số (Population)',
    worldMap: 'Bản đồ thế giới',
    retreat: 'Rút quân',
    logout: 'Đăng xuất',
    underAttack: 'ĐANG BỊ TẤN CÔNG',
    underAttackTitle: 'Đang bị tấn công',
    online: 'ONLINE',
    offline: 'OFFLINE',
    emperor: 'Hoàng Đế'
  },
  build: {
    title: 'XÂY CÔNG TRÌNH',
    buildButton: 'Xây',
    close: 'Đóng',
    cancel: 'Hủy (Esc)',
    cancelPlacement: 'Huỷ đặt',
    population: 'Dân số',
    road: 'Đường',
    roadHint: 'Kéo để vẽ đường. 2 gỗ mỗi ô. Lính đi nhanh hơn 30% trên đường.',
    erase: 'Xoá',
    eraseHint: 'Kéo để xoá đường của bạn. Hoàn lại 100% gỗ nếu chưa xây.',
    lockedAtLevel: 'Cần Nhà chính Lv {{level}}'
  },
  resources: {
    wood: 'Gỗ',
    food: 'Thịt',
    gold: 'Vàng',
    stone: 'Đá'
  },
  details: {
    hp: 'Sinh lực (HP)',
    level: 'Lv {{level}}{{max}}',
    stance: 'Thế trận',
    carrying: 'Đang mang',
    remaining: 'Trữ lượng còn lại:',
    underConstruction: 'Đang xây dựng',
    cancelBuilding: 'Huỷ công trình (Delete)',
    cancelBuildingTitle: 'Huỷ móng nhà, hoàn lại một phần tài nguyên',
    trainingTitle: 'HUẤN LUYỆN QUÂN ĐỘI',
    queue: 'Đang chờ: {{count}}',
    cancelTrainTitle: 'Huỷ đơn vị đang huấn luyện, hoàn lại toàn bộ tài nguyên',
    attack: 'Tấn công: {{value}}',
    hpStat: 'Máu: {{value}}',
    currentLevel: 'Cấp hiện tại: {{level}}/{{max}}',
    trainTime: 'Huấn luyện: {{seconds}}s',
    retreatGate: 'CỔNG RÚT QUÂN',
    retreatAll: 'Rút toàn bộ quân về vương quốc',
    retreatHintTouch: 'Giữ lâu vào cổng để rút quân.',
    retreatHintMouse: 'Chuột phải vào cổng để rút quân.',
    harvestFarmTouch: 'Giữ lâu dân làng vào ruộng để khai thác; ruộng cạn sẽ được gieo lại bằng gỗ.',
    harvestMineTouch: 'Giữ lâu dân làng vào mỏ để tiến hành khai thác.',
    harvestFarmMouse: 'Chuột phải dân làng vào ruộng để khai thác; ruộng cạn sẽ được gieo lại bằng gỗ.',
    harvestMineMouse: 'Chuột phải dân làng vào mỏ để tiến hành khai thác.',
    roadUnderConstruction: 'Đường (đang xây)',
    empireBuff: 'BUFF ĐẾ CHẾ · NHÀ CHÍNH Lv {{level}}',
    trainerEffectHeader: 'HIỆU ỨNG NHÀ HUẤN LUYỆN · Lv {{level}}',
    campEffectHeader: 'HIỆU ỨNG CAMP · Lv {{level}}'
  },
  stats: {
    buildingUnitHp: 'HP công trình & quân',
    unitAttack: 'Tấn công lính',
    trainingTime: 'Thời gian huấn luyện',
    unitHpAttack: 'HP & tấn công lính',
    gatherSpeed: 'Tốc độ gom',
    unloadRadius: 'Bán kính dỡ hàng'
  },
  entityType: {
    unit: 'unit',
    building: 'building',
    resource: 'resource'
  },
  stances: {
    AGGRESSIVE: 'Chủ động',
    DEFENSIVE: 'Phòng thủ',
    STAND_GROUND: 'Cố thủ',
    NO_ATTACK: 'Không đánh'
  },
  resourceNodes: {
    TREE: 'Cây gỗ',
    GOLD_MINE: 'Mỏ vàng',
    STONE_MINE: 'Mỏ đá',
    BERRY: 'Bụi quả'
  },
  upgrades: {
    buildingTitle: 'NÂNG CẤP CÔNG TRÌNH',
    slotTitle: 'Mỗi người chơi nâng tối đa {{count}} công trình cùng lúc',
    slot: 'Slot {{used}}/{{max}}',
    visualTierTitle: 'Hình dáng công trình đổi theo cấp',
    visual: 'Hình {{tier}}/{{count}} · {{name}}',
    changesAt: 'đổi ở Lv {{level}}',
    requiresCore: 'Trụ cột cần Lv {{level}}',
    upgrading: 'Đang nâng cấp',
    cancel: 'Huỷ nâng cấp (hoàn tiền)',
    cancelTitle: 'Huỷ nâng cấp, hoàn lại toàn bộ tài nguyên và giải phóng slot',
    maxed: 'Đã đạt cấp tối đa.',
    slotsFull: 'Đã dùng hết {{count}} slot nâng cấp',
    requiresCoreFirst: 'Cần nâng các công trình trụ cột trước',
    requiresCoreFirstShort: 'Cần đạt cấp trụ cột trước khi nâng Nhà chính',
    insufficient: 'Không đủ tài nguyên',
    upgradeTo: 'Nâng lên Lv {{level}}',
    researchTitle: 'NGHIÊN CỨU QUÂN ĐỘI',
    global: 'Toàn cục',
    cancelResearch: 'Huỷ nghiên cứu, hoàn lại toàn bộ tài nguyên',
    max: 'Tối đa',
    researching: 'Đang nghiên cứu',
    upgradeLevel: 'Nâng Lv {{level}}',
    currentBuff: 'Buff hiện tại',
    afterUpgrade: 'Sau nâng cấp',
    barracksEffect: 'Hiệu ứng nhà lính',
    campEffect: 'Hiệu ứng camp'
  },
  houseTiers: {
    '1': 'Nhà tranh',
    '2': 'Nhà gỗ',
    '3': 'Nhà đá',
    '4': 'Nhà phố',
    '5': 'Trang viên'
  },
  worldMap: {
    title: 'BẢN ĐỒ THẾ GIỚI',
    subtitle: 'Các nước trong vòng 5 cấp Nhà chính của bạn · Bạn đang ở cấp {{level}}',
    refresh: 'Làm mới',
    close: 'Đóng bản đồ',
    aria: 'Bản đồ các nước lân cận',
    you: 'Bạn',
    selfTile: 'Bạn · Lv {{level}}',
    legendWeaker: 'Yếu hơn',
    legendEqual: 'Ngang cấp',
    legendStronger: 'Mạnh hơn',
    pick: 'Chọn một ô trên bản đồ để xem thông tin nước đó.',
    townCenter: 'Nhà chính',
    level: 'Cấp {{level}}',
    delta: 'Chênh lệch',
    remaining: '· còn {{time}}',
    army: 'Quân mang theo',
    selectArmy: 'Hãy chọn quân trên bản đồ chính rồi mở lại bản đồ này.',
    attack: 'Tập kích',
    attacking: 'Đang xuất quân...',
    spectate: 'Quan sát',
    opening: 'Đang mở...',
    minutes: '{{count}} phút',
    hours: '{{count}} giờ',
    days: '{{count}} ngày',
    daysHours: '{{days}} ngày {{hours}} giờ'
  },
  minimap: {
    map: 'Bản đồ',
    kingdom: 'VƯƠNG QUỐC',
    battlefield: 'CHIẾN TRƯỜNG',
    close: 'Đóng',
    closeMap: 'Đóng bản đồ',
    hint: 'Chạm: nhảy tới · Giữ lâu: điều quân',
    title: 'BẢN ĐỒ · {{zone}}'
  },
  session: {
    title: 'TÀI KHOẢN ĐANG ĐƯỢC ĐĂNG NHẬP',
    body: 'Tài khoản này đang được điều khiển đế chế ở một tab hoặc thiết bị khác. Mỗi tài khoản chỉ được có một phiên chơi tại một thời điểm.',
    takeover: 'Đăng xuất thiết bị khác & vào game',
    otherAccount: 'Đăng nhập tài khoản khác',
    note: 'Phiên đang chơi sẽ bị ngắt nếu bạn chọn chiếm quyền.'
  },
  spectator: {
    title: 'ĐANG QUAN SÁT · {{name}}',
    level: 'Nhà chính cấp {{level}} · Chỉ xem, không thể ra lệnh',
    close: 'Đóng cửa sổ quan sát',
    loading: 'Đang mở vương quốc...'
  },
  controlGroups: {
    title: 'NHÓM QUÂN',
    VILLAGER: 'Dân',
    SPEARMAN: 'Giáo',
    ARCHER: 'Cung',
    CAVALRY: 'Kỵ'
  },
  mobile: {
    cancelOrder: 'Huỷ lệnh',
    cancelOrderTitle: 'Huỷ lệnh đang chờ',
    command: 'Ra lệnh',
    commandTitle: 'Chạm điểm đích: đánh / thu hoạch / vào cổng / di chuyển',
    attack: 'Đánh',
    attackTitle: 'Đánh theo đường (attack-move)',
    patrol: 'Tuần tra',
    patrolTitle: 'Tuần tra tới điểm chạm',
    stop: 'Dừng',
    stopTitle: 'Dừng lệnh hiện tại',
    stance: 'Thế trận',
    stanceTitle: 'Đổi thế trận (chủ động / phòng thủ / cố thủ / không đánh)',
    boxSelect: 'Chọn vùng',
    boxSelectTitle: 'Bật rồi kéo một lần để chọn nhiều quân',
    clear: 'Bỏ chọn',
    clearTitle: 'Bỏ chọn toàn bộ',
    zoomOut: 'Thu nhỏ',
    zoomIn: 'Phóng to',
    home: 'Nhà chính',
    homeTitle: 'Về nhà chính'
  },
  orientation: {
    title: 'XOAY NGANG MÁY',
    body: 'Chiến Quốc cần màn hình nằm ngang để hiện bản đồ, minimap và thanh lệnh cùng lúc.'
  },
  buildings: {
    TOWN_CENTER: {
      name: 'Nhà chính',
      description: 'Trái tim của khu định cư. Huấn luyện nông dân và cung cấp dân số cốt lõi.'
    },
    BARRACKS: {
      name: 'Doanh trại',
      description: 'Doanh trại bộ binh. Chiêu mộ giáo binh, xương sống của đội quân cận chiến.'
    },
    STABLE: {
      name: 'Chuồng ngựa',
      description: 'Chuồng ngựa kỵ binh. Nhân giống và huấn luyện kỵ binh cho các cuộc tập kích nhanh.'
    },
    ARCHERY_RANGE: {
      name: 'Trường bắn',
      description: 'Trường bắn cung. Huấn luyện cung thủ chiến đấu từ phía sau chiến tuyến.'
    },
    HOUSE: {
      name: 'Nhà ở',
      description: 'Cung cấp chỗ ở cho thêm tối đa 5 dân số.'
    },
    FARM: {
      name: 'Ruộng',
      description: 'Nguồn lương thực tái tạo. Nông dân khai thác tại chỗ và gieo lại khi ruộng cạn.'
    },
    TOWER: {
      name: 'Tháp canh',
      description: 'Công trình phòng thủ bắn tên vào quân địch đang tiến đến.'
    },
    LUMBER_CAMP: {
      name: 'Trại gỗ',
      description: 'Điểm tập kết gỗ. Nông dân mang gỗ về đây thay vì đi bộ về Nhà chính.'
    },
    MILL: {
      name: 'Cối xay',
      description: 'Điểm tập kết lương thực. Quả mọng và nông sản ruộng được giao ở đây.'
    },
    MINING_CAMP: {
      name: 'Trại mỏ',
      description: 'Điểm tập kết vàng và đá. Phục vụ cả hai loại mỏ từ một chỗ.'
    },
    PORTAL: {
      name: 'Cổng dịch chuyển',
      description: 'Cổng nối vương quốc của bạn với chiến trường chung.'
    }
  },
  units: {
    VILLAGER: {
      name: 'Nông dân',
      description: 'Khai thác tài nguyên và xây dựng công trình cho đế chế.'
    },
    SPEARMAN: {
      name: 'Giáo binh',
      description: 'Bộ binh trang bị giáo, rất mạnh khi đối đầu kỵ binh.'
    },
    ARCHER: {
      name: 'Cung thủ',
      description: 'Đơn vị tầm xa có thể bắn tên từ khoảng cách an toàn.'
    },
    CAVALRY: {
      name: 'Kỵ binh',
      description: 'Kỵ binh nhanh và mạnh, phù hợp với chiến thuật đánh nhanh rút gọn.'
    }
  }
};

export default vi;
