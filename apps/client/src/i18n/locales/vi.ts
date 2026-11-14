/**
 * Vietnamese catalog. Keys are grouped by screen so a missing translation is
 * easy to spot next to the component that renders it.
 */
const vi = {
  common: {
    backHome: 'Về trang chủ',
    language: 'Ngôn ngữ'
  },
  app: {
    metaDescription: 'Vương quốc của bạn đang chờ: xây dựng, phòng thủ và tập kích trong Chiến Quốc.',
    documentTitle: 'Chiến Quốc — Vương quốc của bạn',
    loadingGame: 'Đang tải vương quốc...',
    zoneKingdom: 'VƯƠNG QUỐC',
    zoneRaid: 'TẬP KÍCH',
    sessionExpired: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    invalidSession: 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.',
    connectFailed: 'Không thể kết nối đến máy chủ game. Hãy kiểm tra server đã chạy ở port {{port}}!',
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
  landing: {
    meta: {
      title: 'Chiến Quốc — 2D MMO RTS trên trình duyệt',
      description:
        'Xây dựng đế chế, khai thác tài nguyên và tập kích thế giới trong game RTS isometric trên trình duyệt.'
    },
    brandHome: 'Chiến Quốc — về trang chủ',
    nav: {
      label: 'Điều hướng trang chủ',
      features: 'Tính năng',
      world: 'Thế giới',
      howToPlay: 'Cách chơi'
    },
    hero: {
      badge: '2D ISOMETRIC · MMO RTS',
      titleLine1: 'Xây đế chế.',
      titleLine2: 'Chinh phạt thiên hạ.',
      subtitle:
        'Một vương quốc riêng, bốn nguồn tài nguyên và những cuộc tập kích bất tận. Xây dựng, phòng thủ và mở rộng lãnh thổ ngay trên trình duyệt.',
      playNow: 'Chơi ngay',
      continue: 'Tiếp tục vương quốc',
      continueShort: 'Tiếp tục',
      explore: 'Khám phá tính năng',
      artAlt: 'Nhà chính trong vương quốc của bạn',
      artCaption: 'Vương quốc đang chờ bạn',
      bullets: {
        free: 'Miễn phí',
        browser: 'Chơi trên trình duyệt',
        persistent: 'Tiến trình được lưu'
      }
    },
    features: {
      eyebrow: 'VÌ SAO LÀ CHIẾN QUỐC',
      title: 'Một đế chế, nhiều cách chơi',
      subtitle:
        'Từ nông dân đầu tiên đến đội quân công thành — mọi quyết định đều nằm trong tay bạn.',
      kingdom: {
        title: 'Vương quốc của riêng bạn',
        body:
          'Mỗi tài khoản sở hữu một vương quốc 110×110 với rừng, mỏ và đồng cỏ. Mọi thứ được lưu lại, kể cả khi bạn rời đi.'
      },
      economy: {
        title: 'Kinh tế bốn tài nguyên',
        body:
          'Gỗ, lương, vàng và đá. Điều nông dân, dựng trại khai thác và giữ dòng tài nguyên luôn chảy.'
      },
      army: {
        title: 'Quân đội đa binh chủng',
        body:
          'Giáo binh, cung thủ, kỵ binh và máy bắn đá. Nâng cấp công trình để mở khoá sức mạnh mới.'
      },
      raids: {
        title: 'Tập kích thế giới',
        body:
          'Mở bản đồ, chọn mục tiêu ngang tầm và mang quân đi cướp tài nguyên. Thắng lợi mở ra con đường bá chủ.'
      },
      defense: {
        title: 'Phòng thủ thành trì',
        body:
          'Tường thành, tháp canh và thành trì kiên cố. Kẻ địch có thể đến bất cứ lúc nào — hãy chuẩn bị.'
      },
      mobile: {
        title: 'Chơi mọi lúc, mọi nơi',
        body:
          'Điều khiển bằng chuột hay cảm ứng. Vương quốc của bạn luôn ở đó, trên máy tính lẫn điện thoại.'
      }
    },
    world: {
      eyebrow: 'BẢN ĐỒ THẾ GIỚI',
      title: 'Thiên hạ rộng lớn, nhưng không có chỗ cho kẻ yếu.',
      subtitle: 'Mỗi vương quốc là một thế giới thu nhỏ. Khi đủ mạnh, hãy bước ra ngoài.',
      mapAlt: 'Bản đồ thế giới Chiến Quốc',
      mapCaption: 'BẢN ĐỒ THẾ GIỚI',
      mapFooter: 'Chiến tranh',
      points: {
        target: {
          title: 'Chọn mục tiêu',
          body: 'Lọc các đế chế trong ±5 cấp Nhà chính và chọn kẻ yếu hơn.'
        },
        loot: {
          title: 'Cướp tài nguyên',
          body: 'Thắng trận, bạn lấy 20% mỗi loại tài nguyên của đối thủ (có giới hạn).'
        },
        shield: {
          title: 'Phòng thủ 72 giờ',
          body: 'Sau mỗi trận thua, người chơi được khiên bảo vệ để xây dựng lại.'
        }
      }
    },
    showcase: {
      eyebrow: 'CÔNG TRÌNH & BINH CHỦNG',
      title: 'Mỗi công trình mở ra một nhánh sức mạnh mới',
      subtitle:
        'Dựng Nhà chính, huấn luyện quân đội và biến một ngôi làng nhỏ thành đế chế hùng mạnh.'
    },
    steps: {
      eyebrow: 'BẮT ĐẦU',
      title: 'Khởi đầu trong ba bước',
      subtitle: 'Không cần tải, không cần cày hướng dẫn. Đế chế đầu tiên chỉ cách một cú nhấp.',
      cta: 'Bắt đầu miễn phí',
      one: {
        title: 'Tạo đế chế',
        body: 'Đăng ký miễn phí, đặt tên lãnh chúa và nhận vương quốc đầu tiên.'
      },
      two: {
        title: 'Xây dựng & huấn luyện',
        body: 'Dùng tài nguyên để dựng Nhà chính, doanh trại và chiêu mộ quân.'
      },
      three: {
        title: 'Ra trận',
        body: 'Mở bản đồ thế giới, chọn mục tiêu và dẫn quân đi tập kích.'
      }
    },
    final: {
      title: 'Thiên hạ đang chờ.',
      subtitle: 'Vương quốc của bạn đã sẵn sàng. Chỉ còn thiếu một vị vua.',
      cta: 'Bắt đầu miễn phí',
      note: 'Không cần thẻ tín dụng. Chơi trực tiếp trên trình duyệt.'
    },
    footer: {
      tagline: '2D ISOMETRIC MMO RTS',
      credits: 'Đồ hoạ: SKYZ0R, Bleed, feudalwars (CC-BY). Chi tiết trong CREDITS.md.',
      rights: '© 2026 Chiến Quốc. Bảo lưu mọi quyền.'
    }
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
    showPassword: 'Hiện mật khẩu',
    hidePassword: 'Ẩn mật khẩu',
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
    populationCapped: 'Đã đạt giới hạn dân số — xây thêm nhà ở',
    citadel: 'THÀNH TRÌ',
    citadelTitle: 'Thành trì: {{hp}} / {{maxHp}} máu',
    citadelLow: 'Thành trì dưới ngưỡng nguy hiểm',
    worldMap: 'Bản đồ thế giới',
    retreat: 'Rút quân',
    logout: 'Đăng xuất',
    soundLabel: 'Hiệu ứng âm thanh',
    soundOn: 'Bật âm thanh',
    soundOff: 'Tắt âm thanh',
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
    eraseWall: 'Phá tường',
    eraseWallHint: 'Kéo để dỡ tường của bạn. Đoạn chưa xây xong sẽ được hoàn tài nguyên.',
    lockedAtLevel: 'Cần Nhà chính Lv {{level}}'
  },
  dock: {
    details: 'Chi tiết',
    detailsTitle: 'Mở bảng chi tiết đầy đủ: HP, chỉ số, nâng cấp, nghiên cứu',
    closeDetails: 'Đóng chi tiết',
    pageBuild: 'Xây',
    pageOrders: 'Lệnh',
    pageTrain: 'Huấn luyện',
    pageUpgrade: 'Nâng cấp',
    prevPage: 'Trang trước',
    nextPage: 'Trang sau',
    empty: 'Không có lệnh',
    raidBlocked: 'Không thể xây khi đang tập kích',
    stop: 'Dừng',
    stopTitle: 'Dừng lệnh đang thi hành (S)',
    stance: 'Thế trận',
    stanceTitle: 'Đổi thế trận — đang: {{stance}} (D)',
    attackMove: 'Đánh',
    attackMoveTitle: 'Đánh tới điểm được chọn (A)',
    patrol: 'Tuần tra',
    patrolTitle: 'Tuần tra giữa hai điểm (P)',
    clear: 'Bỏ chọn',
    clearTitle: 'Bỏ chọn toàn bộ (Esc)',
    home: 'Nhà chính',
    homeTitle: 'Đưa camera về Nhà chính (H)',
    cancelTrain: 'Huỷ luyện',
    cancelTrainTitle: 'Huỷ đơn vị đang luyện và hoàn lại nguyên giá',
    upgrade: 'Nâng cấp',
    upgradeTo: 'Nâng lên Lv {{level}}',
    cancelUpgrade: 'Huỷ nâng',
    cancelUpgradeTitle: 'Huỷ nâng cấp đang chạy và hoàn lại giá',
    research: 'Nghiên cứu',
    researchTo: 'Nghiên cứu {{unit}} Lv {{level}}',
    cancelResearch: 'Huỷ nghiên cứu',
    cancelResearchTitle: 'Huỷ nghiên cứu đang chạy và hoàn lại giá',
    slotsFull: 'Đã dùng đủ 2 slot nâng cấp',
    gateBlocked: 'Cần các công trình trụ cột đạt cùng cấp',
    cancelBuilding: 'Huỷ công trình',
    deleteBuilding: 'Xoá công trình',
    retreat: 'Rút quân'
  },
  placement: {
    placing: 'Đang đặt {{name}}',
    hint: 'Chạm mặt đất để xây · nhấn Huỷ để thoát',
    road: 'Đang vẽ đường',
    roadHint: 'Kéo để vẽ · chuột phải hoặc Huỷ để thoát',
    wall: 'Đang xây tường',
    wallHint: 'Kéo để xây tường · chuột phải hoặc Huỷ để thoát',
    wallErase: 'Đang phá tường',
    wallEraseHint: 'Kéo để dỡ tường · chuột phải hoặc Huỷ để thoát',
    insufficient: 'Không đủ tài nguyên',
    stock: 'Đang có: {{amount}}',
    cancel: 'Huỷ',
    cancelTitle: 'Huỷ đặt (Esc)'
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
    deleteBuilding: 'Xoá công trình (Delete)',
    deleteBuildingTitle: 'Phá huỷ công trình này (không hoàn trả tài nguyên)',
    trainingTitle: 'HUẤN LUYỆN QUÂN ĐỘI',
    queue: 'Đang chờ: {{count}}',
    cancelTrainTitle: 'Huỷ đơn vị đang huấn luyện, hoàn lại toàn bộ tài nguyên',
    attack: 'Tấn công: {{value}}',
    hpStat: 'Máu: {{value}}',
    currentLevel: 'Cấp hiện tại: {{level}}/{{max}}',
    trainTime: 'Huấn luyện: {{seconds}}s',
    hotkey: 'Phím tắt: {{key}}',
    unitPower: 'SỨC MẠNH CHIẾN ĐẤU',
    attackPower: 'Tấn công',
    attackRange: 'Tầm đánh',
    cooldown: 'Hồi chiêu',
    speed: 'Tốc độ',
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
    legendDelta: '−N yếu hơn · = ngang cấp · +N mạnh hơn',
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
    hint: 'Chạm: nhảy tới · Giữ lâu: điều quân'
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
    CAVALRY: 'Kỵ',
    CATAPULT: 'Đá'
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
    SIEGE_WORKSHOP: {
      name: 'Xưởng Công Thành',
      description: 'Xưởng công thành. Chế tạo máy bắn đá để nghiền nát đội hình địch.'
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
    WALL: {
      name: 'Tường thành',
      description: 'Một đoạn tường đá. Chắn đường đi và có thể bị phá để mở lối.'
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
    },
    CATAPULT: {
      name: 'Máy bắn đá',
      description: 'Máy công thành bắn đá, gây sát thương cho cả cụm quân địch quanh điểm rơi.'
    }
  }
};

export default vi;
