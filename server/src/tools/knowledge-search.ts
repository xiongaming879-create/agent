/**
 * knowledge_search 工具:检索本地知识库,返回带来源的 top3-5。
 * 从 config.configurable.userId 取 userId(LangGraph 透传)。
 * ES 不可用 catch 返回降级提示(不抛错,让 LLM 改走 search 联网)。
 */
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { hybridSearch } from '../services/rag-search'

export const knowledgeSearchTool = new DynamicStructuredTool({
  name: 'knowledge_search',
  description: `检索本地知识库(历史对话、记忆、已上传文档),返回与查询最相关的 3-5 条文本片段(已 rerank 重排序,每条含来源文档名/页码)。

何时调用:
- 用户明确指向已上传文档("根据我上传的合同/文档...")
- 用户要求回顾历史问答("我之前问过/你之前说过...")
- 问题可能涉及本地积累的资料,且需要准确引用来源

何时不调用:
- 实时信息(天气/新闻/价格)-> 改用 search 联网
- 简单常识/计算 -> 直接回答
- 纯闲聊 -> 直接回答

无命中时:返回空提示,此时不要编造,改用 search 联网或直接告知用户"知识库中未查询到相关内容"。

输入:query(自然语言描述要找的内容),可选 docType/tags 过滤。`,
  schema: z.object({
    query: z.string().describe('检索查询,自然语言描述要找的内容'),
    docType: z.string().optional().describe('文档类型过滤:pdf/markdown/contract/code'),
    tags: z.array(z.string()).optional().describe('标签过滤'),
  }),
  func: async ({ query, docType, tags }, _runManager, config) => {
    const configurable = config?.configurable as { userId?: string } | undefined
    const userId = configurable?.userId ?? ''
    if (!userId) return 'Error: missing userId, knowledge_search unavailable'
    try {
      const hits = await hybridSearch(query, userId, { topN: 5, docType, tags })
      if (hits.length === 0) return '知识库中未查询到相关内容。'
      return hits.map((h, i) =>
        `[${i + 1}] (来源:${h.fileName ?? h.sourceType}${h.pageNumber ? ` p${h.pageNumber}` : ''}) ${h.content}`
      ).join('\n\n')
    } catch (err) {
      return `知识库检索暂时不可用: ${err instanceof Error ? err.message : String(err)}。建议改用 search 联网。`
    }
  },
})
