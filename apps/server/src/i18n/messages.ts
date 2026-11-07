/**
 * The bilingual message catalog.
 *
 * The source text in the code is English (the fallback language). `CATALOG` is
 * keyed by that full English string and maps it to the Vietnamese rendering.
 * `TEMPLATES` holds messages the server composes per outcome or with
 * parameters, keyed semantically; a call site renders the English fallback and
 * the boundary re-renders the active language from `params`.
 */
import type { Locale, TranslateParams } from './index.js';

interface Entry {
  vi: string;
}

export const CATALOG: Record<string, Entry> = {
  // --------------------------------------------------------------- rooms
  'You are watching and cannot issue commands.': { vi: 'Bạn đang ở chế độ quan sát và không thể ra lệnh.' },
  'The battlefield is retired. Use the world map to raid.': { vi: 'Chiến trường đã đóng. Hãy dùng bản đồ thế giới để tập kích.' },
  'Invalid travel portal.': { vi: 'Cổng dịch chuyển không hợp lệ.' },
  'You are already switching maps.': { vi: 'Bạn đang chuyển bản đồ.' },
  'Please wait a moment and try again.': { vi: 'Vui lòng đợi một chút rồi thử lại.' },
  'Too many units in one transfer.': { vi: 'Quá nhiều đơn vị trong một lần chuyển.' },
  'Could not switch maps. Please try again.': { vi: 'Không thể chuyển bản đồ. Vui lòng thử lại.' },
  'Session invalid or expired.': { vi: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' },
  'You cannot enter this kingdom.': { vi: 'Bạn không thể vào vương quốc này.' },
  'The account is signed in somewhere else.': { vi: 'Tài khoản đang được đăng nhập ở nơi khác.' },
  'Another sign-in is being processed, please retry.': { vi: 'Phiên đăng nhập khác đang được xử lý, vui lòng thử lại.' },
  'This kingdom belongs to a different account.': { vi: 'Vương quốc này không thuộc tài khoản đang đăng nhập.' },
  'This raid is no longer valid.': { vi: 'Trận đánh này không còn hiệu lực.' },
  'This raid has ended.': { vi: 'Trận đánh này đã kết thúc.' },
  'The kingdom to watch could not be resolved.': { vi: 'Không xác định được vương quốc cần xem.' },
  'You are already in your own kingdom.': { vi: 'Bạn đang ở trong vương quốc của chính mình.' },
  'This kingdom does not exist or has no Town Center.': { vi: 'Vương quốc này không tồn tại hoặc chưa có Nhà chính.' },
  'This map room has been replaced. Please rejoin.': { vi: 'Bản đồ này đã được thay thế. Hãy thử lại.' },
  'This kingdom no longer has a Town Center to watch.': { vi: 'Vương quốc này không còn Nhà chính để xem.' },
  'You are already watching another kingdom. Close that window first.': { vi: 'Bạn đang quan sát một vương quốc khác. Hãy đóng cửa sổ đó trước.' },
  'You cannot retreat here.': { vi: 'Bạn không có quyền rút quân ở đây.' },
  'Retreat gate not found.': { vi: 'Không tìm thấy cổng rút quân.' },

  // ------------------------------------------------------ command system
  'You may only issue combat orders in this kingdom.': { vi: 'Bạn chỉ có thể ra lệnh chiến đấu trong vương quốc này.' },
  'Portals cannot be built': { vi: 'Không thể xây cổng dịch chuyển.' },
  'Invalid building type': { vi: 'Loại công trình không hợp lệ.' },
  'Insufficient resources to construct building': { vi: 'Không đủ tài nguyên để xây công trình.' },
  'Cannot build outside map bounds': { vi: 'Không thể xây ngoài giới hạn bản đồ.' },
  'Placement obstructed by existing structure or resource': { vi: 'Vị trí xây bị chặn bởi công trình hoặc tài nguyên có sẵn.' },
  'Cannot build on top of a road': { vi: 'Không thể xây trên đường.' },
  'Roads can only be built in a kingdom': { vi: 'Đường chỉ có thể xây trong vương quốc.' },
  'No buildable road tiles': { vi: 'Không có ô đường nào để xây.' },
  'Those tiles are already occupied': { vi: 'Những ô này đã được chiếm chỗ.' },
  'This kingdom has reached its road limit': { vi: 'Vương quốc đã đạt giới hạn đường.' },
  'Not enough wood to build that road': { vi: 'Không đủ gỗ để xây đường.' },
  'Roads can only be removed in a kingdom': { vi: 'Đường chỉ có thể xoá trong vương quốc.' },
  'Too many units in one command': { vi: 'Quá nhiều quân trong một lệnh.' },
  'Invalid move target': { vi: 'Điểm đến không hợp lệ.' },
  'Unit cannot be trained at this structure': { vi: 'Công trình này không huấn luyện được quân đó.' },
  'Population limit reached. Build more Houses!': { vi: 'Đã đạt giới hạn dân số. Hãy xây thêm Nhà ở!' },
  'Insufficient resources to train unit': { vi: 'Không đủ tài nguyên để huấn luyện quân.' },
  'Nothing is being trained here': { vi: 'Không có gì đang được huấn luyện ở đây.' },
  'Unknown unit in training queue': { vi: 'Hàng đợi huấn luyện chứa quân không rõ.' },
  'Not your building': { vi: 'Không phải công trình của bạn.' },
  'Cannot cancel a completed building': { vi: 'Không thể huỷ công trình đã hoàn thành.' },
  'Building no longer exists': { vi: 'Công trình không còn tồn tại.' },
  'Building is still under construction': { vi: 'Công trình vẫn đang được xây.' },
  'Building is already upgrading': { vi: 'Công trình đang được nâng cấp.' },
  'Unknown building type': { vi: 'Loại công trình không rõ.' },
  'Portals cannot be upgraded': { vi: 'Không thể nâng cấp cổng dịch chuyển.' },
  'Building is already at max level': { vi: 'Công trình đã đạt cấp tối đa.' },
  'Insufficient resources to upgrade building': { vi: 'Không đủ tài nguyên để nâng cấp công trình.' },
  'No upgrade is in progress': { vi: 'Không có nâng cấp nào đang chạy.' },
  'Invalid unit type': { vi: 'Loại quân không hợp lệ.' },
  'Unit type is already at max level': { vi: 'Loại quân đã đạt cấp tối đa.' },
  'Another unit research is already in progress': { vi: 'Một nghiên cứu quân khác đang chạy.' },
  'No building trains this unit': { vi: 'Không có công trình nào huấn luyện quân này.' },
  'Insufficient resources to research unit upgrade': { vi: 'Không đủ tài nguyên để nghiên cứu nâng cấp quân.' },
  'No matching unit research is in progress': { vi: 'Không có nghiên cứu quân tương ứng đang chạy.' },
  'Target no longer exists': { vi: 'Mục tiêu không còn tồn tại.' },
  'Cannot attack your own units or buildings': { vi: 'Không thể tấn công quân hoặc công trình của mình.' },
  'That structure cannot be attacked': { vi: 'Công trình này không thể bị tấn công.' },
  'Building is already finished': { vi: 'Công trình đã hoàn thành.' },
  'Only villagers can build': { vi: 'Chỉ nông dân mới có thể xây.' },
  'Unknown unit stance': { vi: 'Thế trận không rõ.' },
  'This building cannot train units': { vi: 'Công trình này không thể huấn luyện quân.' },
  'Invalid rally point': { vi: 'Điểm tập kết không hợp lệ.' },

  // ------------------------------------------------------ economy system
  'Resource node no longer exists': { vi: 'Nguồn tài nguyên không còn tồn tại.' },
  'Resource node is depleted': { vi: 'Nguồn tài nguyên đã cạn.' },
  'Farm no longer exists': { vi: 'Ruộng không còn tồn tại.' },
  'That farm is not yours': { vi: 'Ruộng đó không phải của bạn.' },
  'Farm is still under construction': { vi: 'Ruộng vẫn đang được xây.' },
  'That building cannot be harvested': { vi: 'Công trình này không thể khai thác.' },
  'Farm is empty': { vi: 'Ruộng đã cạn.' },

  // -------------------------------------------------------- HTTP services
  'System error. Please try again.': { vi: 'Lỗi hệ thống. Vui lòng thử lại.' },
  'Invalid raid request.': { vi: 'Dữ liệu tập kích không hợp lệ.' },
  'Invalid retreat request.': { vi: 'Dữ liệu rút quân không hợp lệ.' },
  'Could not load the world map. Please try again.': { vi: 'Không thể tải bản đồ thế giới. Vui lòng thử lại.' },
  'Could not start the raid. Please try again.': { vi: 'Không thể bắt đầu trận tập kích. Vui lòng thử lại.' },
  'Retreat from inside the raid.': { vi: 'Hãy rút quân trong trận đánh.' },
  'Could not retreat. Please try again.': { vi: 'Không thể rút quân. Vui lòng thử lại.' },
  'Too many attempts. Please wait and try again.': { vi: 'Quá nhiều lần thử. Vui lòng đợi rồi thử lại.' },

  // -------------------------------------------------------- raid service
  'Owner is offline': { vi: 'Chủ thành đang ngoại tuyến' },
  'Protected': { vi: 'Đang được bảo vệ' },
  'Recently defeated by you': { vi: 'Bạn vừa thua nước này' },
  'Under attack by another empire': { vi: 'Đang bị nước khác tấn công' },
  'Missing raid details.': { vi: 'Thiếu thông tin trận đánh.' },
  'You cannot attack yourself.': { vi: 'Không thể tấn công chính mình.' },
  'Select at least one unit to attack.': { vi: 'Hãy chọn ít nhất một đơn vị để tấn công.' },
  'Your empire could not be found.': { vi: 'Không tìm thấy nước của bạn.' },
  'The target empire could not be found.': { vi: 'Không tìm thấy nước cần tấn công.' },
  'You have no Town Center yet.': { vi: 'Bạn chưa có Nhà chính.' },
  'This target has no Town Center yet.': { vi: 'Nước này chưa có Nhà chính.' },
  'The Town Center level difference is too large to raid.': { vi: 'Chênh lệch cấp Nhà chính quá lớn để tập kích.' },
  'The defender is offline; pick another target.': { vi: 'Chủ thành đang ngoại tuyến, hãy chọn mục tiêu khác.' },
  'This empire is protected; pick another target.': { vi: 'Nước này đang được bảo vệ, hãy chọn mục tiêu khác.' },
  'You just lost to this empire; wait for the lock to expire.': { vi: 'Bạn vừa thua nước này; phải chờ hết thời gian khoá.' },
  'This empire is already under attack.': { vi: 'Nước này đang bị tấn công.' },
  'No unit is ready to attack.': { vi: 'Không có đơn vị nào sẵn sàng để tấn công.' },

  // -------------------------------------------------------- auth service
  'That username is already taken.': { vi: 'Tên đăng nhập đã được sử dụng.' },
  'That lord name is already taken.': { vi: 'Tên lãnh chúa này đã có người sử dụng.' },
  'That username or lord name is already taken.': { vi: 'Tên đăng nhập hoặc tên lãnh chúa đã được sử dụng.' },
  'Wrong username or password.': { vi: 'Sai tên đăng nhập hoặc mật khẩu.' },
  'The lord name contains invalid characters.': { vi: 'Tên lãnh chúa chứa ký tự không hợp lệ.' },
  'Usernames are 3-24 characters: lowercase letters, digits and _ . -': { vi: 'Tên đăng nhập phải dài 3-24 ký tự, chỉ gồm chữ thường, số và _ . -' }
};

export function staticTranslate(locale: Locale, message: string): string | null {
  const entry = CATALOG[message];
  if (!entry) return null;
  // English is the source language; only Vietnamese needs a lookup.
  return locale === 'vi' ? entry.vi : null;
}

/**
 * Messages the server composes per outcome or with parameters. Unlike the
 * mirrored catalog, these are always looked up by key because there is no
 * single source string: the call site renders the English fallback and the
 * boundary re-renders the active language from `params`.
 */
export const TEMPLATES: Record<string, { vi: string; en: string }> = {
  'raid.maxUnits': {
    vi: 'Chỉ được mang tối đa {{n}} đơn vị mỗi trận.',
    en: 'At most {{n}} units can be brought per raid.'
  },
  'auth.passwordLength': {
    vi: 'Mật khẩu phải có từ {{min}} đến {{max}} ký tự.',
    en: 'The password must be {{min}} to {{max}} characters long.'
  },
  'auth.displayNameLength': {
    vi: 'Tên lãnh chúa phải có từ 2 đến {{max}} ký tự.',
    en: 'The lord name must be 2 to {{max}} characters long.'
  },
  'command.coreGaps': {
    vi: 'Nâng Nhà chính yêu cầu: {{gaps}}',
    en: 'Town Center upgrade requires {{gaps}}'
  },
  'command.upgradeSlots': {
    vi: 'Đã đạt giới hạn nâng cấp công trình ({{max}} lần cùng lúc).',
    en: 'Building upgrade limit reached ({{max}} at a time)'
  },
  'command.buildFirst': {
    vi: 'Cần xây {{name}} trước khi nghiên cứu quân này.',
    en: 'Build {{article}} {{name}} before researching this unit'
  },
  'command.requiresTownCenterLevel': {
    vi: 'Cần Nhà chính cấp {{level}}',
    en: 'Requires Town Center level {{level}}'
  },
  'raid.announce.attackerWon': {
    vi: 'Vương quốc bị tập kích! Mất {{wood}} gỗ, {{food}} lương, {{gold}} vàng, {{stone}} đá.',
    en: 'Your kingdom was raided! Lost {{wood}} wood, {{food}} food, {{gold}} gold and {{stone}} stone.'
  },
  'raid.announce.defenderWon': {
    vi: 'Bạn đã đẩy lùi cuộc tập kích.',
    en: 'You repelled the raid.'
  },
  'raid.announce.retreated': {
    vi: 'Quân tập kích đã rút lui.',
    en: 'The raiding army has withdrawn.'
  }
};

/** Interpolates `{{key}}` placeholders from `params`, leaving unknowns as-is. */
function interpolate(template: string, params: TranslateParams | undefined): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match
  );
}

/** `null` when the key is unknown, so `render()` can fall back on its own. */
export function templateTranslate(
  locale: Locale,
  key: string,
  params?: TranslateParams
): string | null {
  const entry = TEMPLATES[key];
  if (!entry) return null;
  return interpolate(entry[locale] ?? '', params);
}
