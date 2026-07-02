import { GoogleGenerativeAI } from '@google/generative-ai';
import { Clinic } from '@prisma/client';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AiConversationState } from '../../types';
import { buildSystemPrompt } from './prompts';
import { z } from 'zod';

const BrainResponseSchema = z.object({
  reply: z.string().min(1),
  extracted: z.record(z.string(), z.any()).default({}),
  isComplete: z.boolean().default(false),
  escalate: z.boolean().default(false),
  escalationReason: z.string().nullable().default(null),
});

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

interface BrainResult {
  reply: string;
  extracted: Record<string, any>;
  isComplete: boolean;
  escalate: boolean;
  escalationReason: string | null;
}

// Strips markdown fences Gemini sometimes wraps around JSON responses.
function cleanJson(raw: string): string {
  return raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
}

export async function processMessage(
  message: string,
  state: AiConversationState,
  clinic: Clinic
): Promise<BrainResult> {
  logger.info(`Gemini key check — length: ${env.GEMINI_API_KEY?.length}, prefix: ${env.GEMINI_API_KEY?.slice(0, 6)}`);

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: buildSystemPrompt(clinic),
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3,
      maxOutputTokens: 500,
    },
  });

  // Build conversation history for Gemini.
  // Map our roles (user/model) to Gemini's expected format.
  const contents = [
    // Inject current state as context so the model knows what's collected
    {
      role: 'user' as const,
      parts: [{ text: `CURRENT STATE: ${JSON.stringify({ collectedData: state.data, conversationState: state.state })}` }],
    },
    { role: 'model' as const, parts: [{ text: '{"reply":"Understood, continuing from current state.","extracted":{},"isComplete":false,"escalate":false,"escalationReason":null}' }] },
    // Add conversation history (last 10 turns to stay within token limits)
    ...state.history.slice(-10).map((h) => ({
      role: h.role as 'user' | 'model',
      parts: [{ text: h.content }],
    })),
    // The new inbound message
    { role: 'user' as const, parts: [{ text: message }] },
  ];

  try {
    const result = await model.generateContent({ contents });
    const raw = cleanJson(result.response.text());
    const parsed = BrainResponseSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`Invalid Gemini response shape: ${parsed.error.message}`);
    }
    return parsed.data;
  } catch (err: any) {
    logger.error('Zero AI brain error', { error: err.message, clinicId: clinic.id });
    // Safe fallback — keeps the conversation alive without crashing
    return {
      reply: "Could you say that again? I want to make sure I get your details right.",
      extracted: {},
      isComplete: false,
      escalate: false,
      escalationReason: null,
    };
  }
}
