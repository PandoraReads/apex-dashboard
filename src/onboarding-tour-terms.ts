/**
 * Feature-name highlighting for the onboarding tour's step cards: nouns that
 * name a real feature (分区 / 小组件 / 设置 …) render in the error-red accent
 * so newcomers can tie each sentence to the thing on screen.
 *
 * The locale copy stays plain text — terms are matched after the fact against
 * a curated per-language list, so a missed term simply renders unstyled (soft
 * failure) instead of leaking markup through 11 locale files.
 */
import { getLocale, type Language } from './i18n';

/**
 * Terms are matched longest-first, so list both phrases and their shorter
 * substrings (普通工作台 before 工作台). Pure-ASCII terms match on word
 * boundaries ("pin" never matches inside "unpinned"); scripts without ASCII
 * \w semantics (CJK, Cyrillic, Greek, Thai) match as plain substrings, so
 * those lists carry the inflections the copy actually uses.
 */
const TOUR_TERMS: Record<Language, readonly string[]> = {
	en: [
		'Common Actions bar', 'immersive poster board', 'classic workbench',
		'statistics view', 'section gallery', 'section board', 'command palette',
		'widget sidebar', 'widget rail', 'workspace pages', 'poster image',
		'today note', 'quick command', 'rotating quotes',
		'dashboard', 'workbench', 'banner', 'sidebar', 'pencil', 'quotes',
		'sections', 'section', 'widgets', 'settings', 'pills', 'pill',
		'layout', 'layouts', 'calendar', 'kanban', 'notes', 'note', 'tasks',
		'media', 'projects', 'weather', 'pomodoro', 'habits', 'expenses',
		'button', 'pin', 'sticky notes', 'project boards', 'folders',
		'databases',
	],
	zh: [
		'沉浸式海报工作台', '普通工作台', '数据统计视图', '常用操作条', '页面标签',
		'分区画廊', '命令面板', '今日笔记', '名人名言', '海报图片', '房子图标',
		'工作台', '海报区', '侧边栏', '小组件', '图钉', '横幅', '功能区',
		'分区', '海报', '名言', '设置', '布局', '日历', '看板', '番茄钟',
		'习惯打卡', '记账', '天气', '闪念', '素材', '项目', '笔记', '待办', '页面',
		'标签', '常用命令', '便利贴', '项目管理', '文件夹', '数据库',
	],
	'zh-TW': [
		'沉浸式海報工作臺', '經典工作臺', '資料統計檢視', '常用操作條', '頁面標籤',
		'分割槽畫廊', '命令面板', '今日筆記', '名人名言', '海報圖片', '房子圖示',
		'工作臺', '海報區', '側邊欄', '小元件', '圖釘', '橫幅', '功能區',
		'分割槽', '海報', '名言', '設定', '佈局', '日曆', '看板', '番茄鍾',
		'習慣打卡', '記賬', '天氣', '閃念', '素材', '專案', '筆記', '待辦', '頁面',
		'標籤', '常用命令', '便利貼', '專案管理', '資料夾', '資料庫',
	],
	de: [
		'Schnellzugriffsleiste', 'Arbeitsbereich-Seiten', 'klassische Werkbank',
		'Widget-Seitenleiste', 'Widget-Leiste', 'Abschnitts-Galerie',
		'Abschnittstafel', 'Befehlspalette', 'Statistikansicht', 'heutige Notiz',
		'Schnellbefehl', 'Poster-Board',
		'Werkbank', 'Banner', 'Poster', 'Zitate', 'Nadel', 'Stift', 'Dashboard',
		'Abschnitte', 'Abschnitt', 'Widgets', 'Einstellungen', 'Pillen', 'Pille',
		'Layout', 'Kalender', 'Kanban', 'Notizen', 'Aufgaben', 'Medien',
		'Projekte', 'Wetter', 'Pomodoro', 'Gewohnheiten', 'Ausgaben',
		'Haftnotizen', 'Projektmanagement', 'Ordner', 'Datenbanken',
	],
	es: [
		'barra de acciones frecuentes', 'tablero de póster inmersivo',
		'mesa de trabajo clásica', 'vista de estadísticas', 'barra lateral',
		'barra de widgets', 'galería de secciones', 'tablero de secciones',
		'paleta de comandos', 'nota de hoy', 'comando rápido',
		'mesa de trabajo', 'espacio de trabajo',
		'banner', 'póster', 'citas', 'alfiler', 'lápiz', 'píldoras', 'píldora',
		'pestañas', 'secciones', 'sección', 'widgets', 'ajustes', 'clima',
		'calendario', 'pomodoro', 'hábitos', 'gastos', 'notas', 'tareas',
		'multimedia', 'proyectos', 'notas adhesivas', 'gestión de proyectos',
		'carpetas', 'bases de datos',
	],
	fr: [
		"barre d'actions rapides", "tableau d'affichage immersif",
		'atelier classique', 'vue statistiques', 'barre latérale',
		'rail de widgets', 'galerie de sections', 'tableau des sections',
		'palette de commandes', 'note du jour', 'commande rapide',
		'atelier', 'bannière', 'affiche', 'citations', 'épingle', 'crayon',
		'pastilles', 'pastille', 'sections', 'section', 'widgets', 'réglages',
		'météo', 'calendrier', 'pomodoro', 'habitudes', 'dépenses', 'notes',
		'tâches', 'médias', 'projets', 'notes mémo', 'gestion de projets',
		'dossiers', 'bases de données',
	],
	ja: [
		'共通操作バー', '没入型ポスターボード', 'クラシックボード',
		'クラシックなワークベンチ', 'セクションギャラリー', 'セクション看板',
		'コマンドパレット', '今日のノート', 'ウィジェット欄', 'サイドバー',
		'ワークベンチ', 'ポスター画像', 'ダッシュボード', 'バナー', '名言', 'ピン',
		'セクション', 'ウィジェット', '設定', '番号タブ', 'タブ', 'レイアウト',
		'天気', 'カレンダー', 'ポモドーロ', '習慣', '家計簿', 'クイックコマンド',
		'ノート', 'タスク', '素材', 'プロジェクト', '付箋', 'プロジェクト管理',
		'フォルダー', 'データベース',
	],
	ko: [
		'공용 작업 모음', '몰입형 포스터 보드', '클래식 작업대', '통계 보기',
		'위젯 사이드바', '위젯 막대', '섹션 갤러리', '섹션 보드', '명령 팔레트',
		'오늘의 노트', '빠른 명령',
		'작업대', '포스터 이미지', '포스터', '명언', '배너', '핀', '섹션',
		'위젯', '설정', '알약', '레이아웃', '날씨', '캘린더', '뽀모도로', '습관',
		'가계부', '노트', '할 일', '자료', '프로젝트', '대시보드',
		'스티커 메모', '프로젝트 관리', '폴더', '데이터베이스',
	],
	'pt-BR': [
		'barra de ações rápidas', 'quadro de pôster imersivo', 'bancada clássica',
		'visão de estatísticas', 'barra lateral', 'trilho de widgets',
		'galeria de seções', 'quadro de seções', 'paleta de comandos',
		'nota de hoje', 'comando rápido', 'bancada', 'espaço de trabalho',
		'banner', 'pôster', 'citações', 'citação', 'alfinete', 'lápis',
		'pílulas', 'pílula', 'seções', 'seção', 'widgets', 'configurações',
		'clima', 'calendário', 'pomodoro', 'hábitos', 'despesas', 'notas',
		'tarefas', 'mídia', 'projetos', 'lembretes', 'gestão de projetos',
		'pastas', 'bancos de dados',
	],
	ru: [
		'панель быстрых действий', 'иммерсивная доска-постер',
		'классический рабочий стол', 'вид статистики', 'боковая панель',
		'панель виджетов', 'галерея разделов', 'доска разделов',
		'палитра команд', 'заметка дня', 'заметку дня', 'быстрая команда',
		'рабочий стол', 'баннер', 'постер', 'цитаты', 'цитата', 'булавка',
		'карандаш', 'разделы', 'раздел', 'виджеты', 'виджет', 'настройках',
		'настройки', 'кнопки', 'кнопка', 'кнопку', 'кнопке', 'раскладка',
		'раскладки', 'погода', 'календарь', 'помодоро', 'привычки', 'расходы',
		'заметки', 'задачи', 'материалы', 'проекты', 'дашборд',
		'стикеры', 'управление проектами', 'папки', 'базы данных',
	],
	th: [
		'แถบการดำเนินการ', 'บอร์ดโปสเตอร์แบบอิมเมอร์ซีฟ', 'โต๊ะทำงานคลาสสิก',
		'มุมมองสถิติ', 'แถบข้าง', 'แถบวิดเจ็ต', 'แกลเลอรีเซกชัน',
		'กระดานเซกชัน', 'พาเล็ตคำสั่ง', 'โน้ตวันนี้', 'คำสั่งด่วน',
		'โต๊ะทำงาน', 'โปสเตอร์', 'คำคม', 'หมุด', 'แบนเนอร์', 'เซกชัน',
		'วิดเจ็ต', 'การตั้งค่า', 'ปุ่ม', 'เลย์เอาต์', 'พยากรณ์', 'ปฏิทิน',
		'โพโมโดโร', 'การสร้างนิสัย', 'บัญชีรายรับย่อย', 'โน้ต',
		'งานที่ต้องทำ', 'สื่อ', 'โปรเจกต์', 'แดชบอร์ด', 'โน้ตแนบ',
		'การจัดการโปรเจกต์', 'โฟลเดอร์', 'ฐานข้อมูล',
	],
};

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Pure-ASCII terms are safe to anchor with \b; other scripts (CJK,
 *  Cyrillic, Thai) have no ASCII word boundaries and match as substrings. */
const ASCII_TERM = /^[A-Za-z0-9'\- ]+$/;

/** Escape `text`, then wrap every occurrence of a term in the accent span.
 *  Longest-first alternation makes phrases win over their own substrings. */
export function highlightTextWithTerms(text: string, terms: readonly string[]): string {
	const escaped = escapeHtml(text);
	const usable = terms.filter(term => term.length > 0);
	if (usable.length === 0) return escaped;
	const sorted = [...usable].sort((a, b) => b.length - a.length);
	const alternation = sorted
		.map(term => {
			const pattern = escapeRegExp(escapeHtml(term));
			return ASCII_TERM.test(term) ? `\\b${pattern}\\b` : pattern;
		})
		.join('|');
	return escaped.replace(
		new RegExp(alternation, 'gi'),
		match => `<span class="apex-tour-term">${match}</span>`,
	);
}

/** Map the BCP-47 locale (i18n.ts's getLocale) back to a plugin language,
 *  mirroring the zh/zh-TW split the language picker normalizes on the way in. */
export function localeToTourLanguage(locale: string): Language {
	const normalized = locale.toLowerCase();
	if (normalized.startsWith('zh')) {
		return /(?:tw|hk|mo|hant)/.test(normalized.replace(/-/g, '')) ? 'zh-TW' : 'zh';
	}
	switch (normalized.split('-')[0]) {
		case 'ja': return 'ja';
		case 'ko': return 'ko';
		case 'es': return 'es';
		case 'de': return 'de';
		case 'fr': return 'fr';
		case 'pt': return 'pt-BR';
		case 'ru': return 'ru';
		case 'th': return 'th';
		default: return 'en';
	}
}

/** Locale-aware entry point used by the tour card renderer. */
export function highlightTourTerms(text: string): string {
	return highlightTextWithTerms(text, TOUR_TERMS[localeToTourLanguage(getLocale())]);
}
