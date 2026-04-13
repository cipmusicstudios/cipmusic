/**
 * 乐库页浏览上下文 — Smart Radio 用于加权推荐（与 MusicTab 状态同步）。
 */
export type MusicPlaybackContext = {
  /** 当前是否在乐库 tab */
  musicLibraryActive: boolean;
  musicView: 'artists' | 'songs' | 'artist_detail' | null;
  /** 艺人详情页：当前艺人 canonical id（含 project / IP 行） */
  artistContextId: string | null;
  /** 歌曲列表：当前筛选类别；'all' 表示未筛选 */
  categoryKey: string | null;
};

export const defaultMusicPlaybackContext: MusicPlaybackContext = {
  musicLibraryActive: false,
  musicView: null,
  artistContextId: null,
  categoryKey: null,
};
