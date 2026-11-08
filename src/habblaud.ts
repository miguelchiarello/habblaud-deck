// Single bridge to the Habblaud checkout next to this folder (../habblaud).
// Habblaud's pixel art is pure (PixelBuf, no DOM), so the deck reuses the exact same characters and furniture.
export { PixelBuf } from '../../habblaud/client/src/art/core/pixbuf';
export type { BufSprite } from '../../habblaud/client/src/art/core/sprite';
export { renderCharacter, CHAR_W, CHAR_H, POSE_FRAMES, POSE_DURATION } from '../../habblaud/client/src/art/character/render';
export { appearanceFromSeed } from '../../habblaud/client/src/art/character/appearance';
export { renderFurniture } from '../../habblaud/client/src/art/furniture/index';
export { renderIcon } from '../../habblaud/client/src/art/icons';
export { floorChunk, CHUNK_PX } from '../../habblaud/client/src/art/surfaces/floor';
export { wallFaceTile } from '../../habblaud/client/src/art/surfaces/walls';
export { roomTheme } from '../../habblaud/client/src/art/theme';
export { shade } from '../../habblaud/client/src/art/core/color';
export type { Appearance, Pose, HeldItem, Dir, IconName, RoomTheme } from '../../habblaud/client/src/art/api';
export type {
  OfficeSnapshot, AgentInfo, RoomInfo, AccountInfo, PermissionRequestInfo, ActivityKind, Notice,
} from '../../habblaud/shared/types';
