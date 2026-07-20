/**
 * 内置知识兜底：常见事实性信息（节假日、常识），避免 Agent 反复联网搜索。
 * 这些信息是公开且固定的，无需通过 search/fetch 获取。
 */

interface HolidayInfo {
  name: string
  date: string
  detail: string
}

/** 2025-2027 年中国法定节假日及传统节日日期。 */
const HOLIDAYS: HolidayInfo[] = [
  { name: '2026年中秋节', date: '2026年9月25日（周五）', detail: '农历八月十五。2026年中秋在9月25日。' },
  { name: '2026年国庆节', date: '2026年10月1日（周四）', detail: '固定10月1日。2026年国庆假期通常为10月1日-10月7日。' },
  { name: '2026年中秋+国庆', date: '2026年9月25日 ~ 10月7日', detail: '两节相邻，中秋9月25日（周五），国庆10月1日（周四）。中间9月26-30日仅4个工作日，适合拼假组成约13天长假（9月25日-10月7日）。' },

  { name: '2025年中秋节', date: '2025年10月6日（周一）', detail: '农历八月十五。2025年中秋与国庆假期相连。' },
  { name: '2025年国庆节', date: '2025年10月1日（周三）', detail: '固定10月1日。2025年国庆假期10月1日-10月8日（与中秋合并调休）。' },

  { name: '2027年中秋节', date: '2027年9月15日（周三）', detail: '农历八月十五。2027年中秋在9月15日。' },
  { name: '2027年国庆节', date: '2027年10月1日（周五）', detail: '固定10月1日。2027年国庆假期10月1日-10月7日。' },

  { name: '春节', date: '农历正月初一', detail: '春节日期按农历计算，每年不同。2026年春节为2月17日。' },
  { name: '端午节', date: '农历五月初五', detail: '2026年端午节为6月19日。' },
  { name: '清明节', date: '按节气，通常4月4日或5日', detail: '2026年清明节为4月5日。' },
  { name: '劳动节', date: '5月1日', detail: '固定5月1日。' },
]

/** 通用常识，避免无意义搜索。 */
const COMMON_FACTS: string[] = [
  '中秋节：每年农历八月十五，以月圆象征团圆，吃月饼、赏月。',
  '国庆节：每年10月1日，中华人民共和国成立纪念日，法定放假7天（通常调休）。',
  '春节：农历正月初一，中国最重要的传统节日。',
  '西藏首府：拉萨。深圳到拉萨直飞航班约4.5小时，经成都/重庆/西安中转更便宜。',
  '西藏旅游旺季：6-10月，其中9-10月秋景最佳，含国庆假期。',
  '高原反应：拉萨海拔约3650米，建议前1-2天避免剧烈运动，可提前服用红景天。',
  '2026美加墨世界杯：赛期 2026年6月11日 ~ 2026年7月19日，由美国/加拿大/墨西哥联合举办。淘汰赛阶段7月初开始，半决赛约7月15-16日，决赛7月19日。具体每日赛程需搜索确认。',
]

/** 构建内置知识上下文，注入到 system prompt。 */
export function buildKnowledgeContext(): string {
  const holidayLines = HOLIDAYS.map(h => `- ${h.name}：${h.date}。${h.detail}`).join('\n')
  const factLines = COMMON_FACTS.map(f => `- ${f}`).join('\n')
  return `## 内置知识库（优先使用，无需搜索）

### 节假日日期（已内置，不要搜索）
${holidayLines}

### 常识
${factLines}

### 知识使用规则
1. **优先用内置知识**：涉及节假日、日期、常识性信息时，直接使用上面的内置知识，不要调用 search/fetch。
2. **必须搜索时**：仅当内置知识无法覆盖（如实时机票价格、具体航班班次、最新政策）才搜索。
3. **搜索容错**：search 超时或返回空时，先简化关键词重试一次（如只搜"2026中秋日期"）；再失败则用内置知识继续规划，不要中断。
4. **fetch 使用限制**：只在明确知道完整 URL 时使用 fetch，不要猜测 URL 结构。`
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}年${m}月${day}日`
}

/**
 * 动态生成当前日期上下文，注入到 system prompt 最顶部。
 * 用 new Date() 取服务器系统时钟，无需手动维护硬编码日期。
 * 预算好昨天/今天/明天/后天，模型直接读不需要自己算。
 */
export function buildDateContext(): string {
  const now = new Date()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const dayAfter = new Date(today)
  dayAfter.setDate(dayAfter.getDate() + 2)

  const todayStr = formatDate(today)
  const weekday = WEEKDAYS[today.getDay()]

  return `## 【硬性全局规则·最高优先级】当前基准时间（不可篡改）

1. 本机系统标准当前日期：${todayStr} ${weekday}
2. 相对日期换算（必须以此为准，禁止联网搜索当前日期，禁止采信网页发布日期当今日）：
   - 昨天 = ${formatDate(yesterday)}
   - 今天 = ${todayStr}
   - 明天 = ${formatDate(tomorrow)}
   - 后天 = ${formatDate(dayAfter)}
3. 只有查询历史过往日期或未来特定事件（如"2026世界杯赛程"）才允许搜索；询问"今天/明天/后天/本周/下月"等相对时间，一律用上方固定基准换算，不搜索、不调工具。
4. 搜索赛事/新闻时，用换算出的绝对日期去搜（如搜"${formatDate(dayAfter)} 世界杯 赛程"），不要搜"后天世界杯"。`
}
