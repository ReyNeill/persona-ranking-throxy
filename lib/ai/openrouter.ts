import { createOpenRouter } from "@openrouter/ai-sdk-provider"

type OpenRouterProvider = ReturnType<typeof createOpenRouter>
type OpenRouterModel = ReturnType<OpenRouterProvider["chat"]>

let cachedOpenRouter: OpenRouterProvider | null = null

export function getOpenRouterModel(modelId: string): OpenRouterModel | null {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  if (!cachedOpenRouter) {
    cachedOpenRouter = createOpenRouter({ apiKey })
  }

  const includeUsage = process.env.OPENROUTER_USAGE !== "false"
  return cachedOpenRouter.chat(
    modelId,
    includeUsage
      ? {
          usage: {
            include: true,
          },
        }
      : undefined
  )
}
