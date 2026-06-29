import { GoogleGenerativeAI } from '@google/generative-ai';
import { Clinic } from '@prisma/client';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AiConversationState } from '../../types';
import { buildSystemPrompt } from './prompts';

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
    const parsed = JSON.parse(raw);

    return {
      reply: parsed.reply || "I didn't catch that — could you say it again?",
      extracted: parsed.extracted || {},
      isComplete: parsed.isComplete === true,
      escalate: parsed.escalate === true,
      escalationReason: parsed.escalationReason || null,
    };
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
