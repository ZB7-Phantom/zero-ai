/**
 * Zero Deterministic Brain v1.0
 *
 * A fully deterministic conversation engine for patient intake.
 * No LLM dependencies. Processes every message through six layers:
 * normalise → classify intent → extract entities → detect escalation
 * → advance state machine → select response.
 *
 * Design principle: Zero should feel warm and human while being
 * completely predictable and reliable. Responses are pre-written
 * in Zero's voice and selected by state — never generated.
 *
 * When genuinely stuck (patient sends unrecognisable input twice
 * in a row), Zero escalates to staff rather than looping forever.
 */

import { Clinic } from '@prisma/client';
import { AiConversationState } from '../../types';
import { logger } from '../../config/logger';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface BrainResult {
  reply: string;
  extracted: Partial<IntakeData>;
  isComplete: boolean;
  escalate: boolean;
  escalationReason: string | null;
}

interface IntakeData {
  name: string;
  age: number;
  gender: string;
  complaint: string;
  symptoms: string;
  appointmentDate: string;
  appointmentTime: string;
  mode: 'walkin' | 'appointment' | 'onmyway' | 'queue_check';
}

type Intent =
  | 'GREETING'
  | 'WALKIN'
  | 'APPOINTMENT'
  | 'ON_MY_WAY'
  | 'QUEUE_CHECK'
  | 'PROVIDING_DATA'
  | 'CANCEL'
  | 'RESTART'
  | 'ESCALATION_TRIGGER'
  | 'UNKNOWN';

// ─── LAYER 1: NORMALISER ──────────────────────────────────────────────────────

/**
 * Cleans raw WhatsApp input before any processing.
 * Handles common WhatsApp artifacts: emoji, excessive punctuation,
 * voice-to-text artifacts, and inconsistent casing.
 */
function normalise(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    // Strip emoji — they carry no intake data
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── LAYER 2: INTENT CLASSIFIER ───────────────────────────────────────────────

/**
 * Classifies the patient's intent from their message.
 * Uses pattern matching on normalised input — ordered from most
 * specific to most general so specific patterns win over generic ones.
 *
 * "providing data" is the default for mid-conversation messages
 * where the patient is answering Zero's last question.
 */
function classifyIntent(text: string, state: AiConversationState): Intent {
  // Check menu selections first — these are unambiguous
  if (['START', 'MENU', 'IDLE'].includes(state.state)) {
    if (/^[1１]$/.test(text.trim())) return 'WALKIN';
    if (/^[2２]$/.test(text.trim())) return 'APPOINTMENT';
    if (/^[3３]$/.test(text.trim())) return 'ON_MY_WAY';
    if (/^[4４]$/.test(text.trim())) return 'QUEUE_CHECK';
  }

  // Escalation triggers — checked first, highest priority
  if (matchesAny(text, ESCALATION_PATTERNS)) return 'ESCALATION_TRIGGER';

  // Explicit menu selections or restart commands
  if (matchesAny(text, RESTART_PATTERNS)) return 'RESTART';
  if (matchesAny(text, CANCEL_PATTERNS)) return 'CANCEL';

  // Queue check — patient wants to know their number
  if (matchesAny(text, QUEUE_CHECK_PATTERNS)) return 'QUEUE_CHECK';

  // Mode selection — only classify these as intents at START/MENU state
  if (['START', 'MENU'].includes(state.state)) {
    if (matchesAny(text, WALKIN_PATTERNS)) return 'WALKIN';
    if (matchesAny(text, APPOINTMENT_PATTERNS)) return 'APPOINTMENT';
    if (matchesAny(text, ON_MY_WAY_PATTERNS)) return 'ON_MY_WAY';
    // Greeting at start — show menu
    if (matchesAny(text, GREETING_PATTERNS)) return 'GREETING';
  }

  // Mid-conversation — patient is providing intake data
  if (!['START', 'MENU', 'IDLE', 'COMPLETE'].includes(state.state)) {
    return 'PROVIDING_DATA';
  }

  // Fallback — greeting or unknown at menu state
  if (matchesAny(text, GREETING_PATTERNS)) return 'GREETING';
  return 'UNKNOWN';
}

// ─── INTENT PATTERN LISTS ─────────────────────────────────────────────────────

const GREETING_PATTERNS = [
  /^(hi|hello|hey|good morning|good afternoon|good evening|hiya|howdy|yo|sup)[\s!.,]*$/,
  /^(hi there|hello there|hey there)[\s!.,]*$/,
];

const WALKIN_PATTERNS = [
  /\b(walk.?in|walk in|queue|join queue|register|sign up|check in|i('m| am) here|i want to see|i need to see|i('d| would) like to see)\b/,
  /^(1|one)[\s.]*$/,
];

const APPOINTMENT_PATTERNS = [
  /\b(book|appointment|schedule|reserve|fix a date|set up|i('d| would) like to book)\b/,
  /^(2|two)[\s.]*$/,
];

const ON_MY_WAY_PATTERNS = [
  /\b(on my way|omw|coming|heading|leaving|en route|almost there|i('m| am) coming)\b/,
  /^(3|three)[\s.]*$/,
];

const QUEUE_CHECK_PATTERNS = [
  /\b(queue|my (number|turn|position)|how long|when (is it|will it be) my turn|what('s| is) my (number|queue))\b/,
  /^(4|four)[\s.]*$/,
];

const RESTART_PATTERNS = [
  /^(restart|start over|reset|menu|main menu|back|go back)[\s.]*$/,
];

const CANCEL_PATTERNS = [
  /\b(cancel|i don't want|never mind|nevermind|forget it|stop)\b/,
];

// Escalation — medical emergencies, distress, billing, anger
const ESCALATION_PATTERNS = [
  // Medical emergency keywords
  /\b(chest (pain|tightness|pressure)|can't breathe|difficulty breathing|shortness of breath)\b/,
  /\b(heart attack|stroke|unconscious|collapse|seizure|severe bleeding|emergency)\b/,
  /\b(can't (walk|move|feel)|paralysed|passed out|blacked out)\b/,
  // High distress
  /\b(this is (ridiculous|unacceptable)|i (want to|will) sue|i'm (furious|disgusted|livid))\b/,
  /\b(worst (clinic|service|place)|absolute (joke|disgrace))\b/,
  // Billing complexity
  /\b(insurance|hmo|nhis|i (won't|refuse to) pay|billing (error|issue|dispute))\b/,
];

// ─── LAYER 3: ENTITY EXTRACTOR ────────────────────────────────────────────────

/**
 * Extracts intake fields from freeform patient messages.
 *
 * Handles common WhatsApp patterns:
 * - Single-field answers: "John", "34", "male", "headache"
 * - Multi-field answers: "I'm John, 34, male" (handled on name + age + gender pass)
 * - Natural language: "I've been having a terrible headache since yesterday"
 *
 * Returns only fields that were actually found — never guesses.
 */
function extractEntities(
  text: string,
  currentState: string,
  collectedData: Partial<IntakeData>
): Partial<IntakeData> {
  const extracted: Partial<IntakeData> = {};
  const raw = text; // Keep original case for name extraction
  const norm = normalise(text);

  // NAME — only extract if not already collected
  if (!collectedData.name) {
    const name = extractName(raw, norm);
    if (name) extracted.name = name;
  }

  // AGE — extract if not collected
  if (!collectedData.age) {
    const age = extractAge(norm);
    if (age) extracted.age = age;
  }

  // GENDER — extract if not collected
  if (!collectedData.gender) {
    const gender = extractGender(norm);
    if (gender) extracted.gender = gender;
  }

  // COMPLAINT — extract if not collected and we're in right state
  if (!collectedData.complaint && collectedData.name) {
    const complaint = extractComplaint(norm);
    if (complaint) extracted.complaint = complaint;
  }

  // SYMPTOMS — only after complaint is collected
  if (collectedData.complaint && !collectedData.symptoms) {
    const symptoms = extractSymptoms(norm, collectedData.complaint);
    if (symptoms) extracted.symptoms = symptoms;
  }

  // APPOINTMENT DATE
  if (!collectedData.appointmentDate && collectedData.mode === 'appointment') {
    const date = extractDate(norm);
    if (date) extracted.appointmentDate = date;
  }

  // APPOINTMENT TIME
  if (collectedData.appointmentDate && !collectedData.appointmentTime) {
    const time = extractTime(norm);
    if (time) extracted.appointmentTime = time;
  }

  return extracted;
}

function extractName(raw: string, norm: string): string | null {
  // "my name is X" / "I am X" / "I'm X" / "call me X"
  const explicit = raw.match(
    /(?:my name is|i am|i'm|call me|name[:\s]+)\s*([A-Z][a-z]+(?: [A-Z][a-z]+)*)/i
  );
  if (explicit) return explicit[1].trim();

  // Comma-separated intro: "John, 34, male" — first token is name
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.length >= 2 && /^[A-Z][a-z]+(?: [A-Z][a-z]+)*$/.test(parts[0])) {
    return parts[0];
  }

  // Single capitalised word/phrase with no numbers — likely just a name
  if (/^[A-Z][a-z]+(?: [A-Z][a-z]+)*$/.test(raw.trim()) && !/\d/.test(raw)) {
    return raw.trim();
  }

  return null;
}

function extractAge(norm: string): number | null {
  // "I am 34" / "34 years old" / "age 34" / just "34"
  const patterns = [
    /\b(?:i am|i'm|age[:\s]+|aged?)\s*(\d{1,3})\b/,
    /\b(\d{1,3})\s*(?:years? old|yrs? old|y\.?o\.?)\b/,
    /^(\d{1,3})$/,
  ];
  for (const p of patterns) {
    const m = norm.match(p);
    if (m) {
      const age = parseInt(m[1]);
      if (age >= 1 && age <= 120) return age;
    }
  }
  return null;
}

function extractGender(norm: string): string | null {
  if (/\b(male|man|boy|m)\b/.test(norm)) return 'Male';
  if (/\b(female|woman|girl|lady|f)\b/.test(norm)) return 'Female';
  if (/\b(prefer not|rather not|skip|other|non.?binary)\b/.test(norm)) return 'Prefer not to say';
  // Single letter responses
  if (/^m$/.test(norm.trim())) return 'Male';
  if (/^f$/.test(norm.trim())) return 'Female';
  return null;
}

function extractComplaint(norm: string): string | null {
  // Strip common filler phrases to get the core complaint
  const cleaned = norm
    .replace(/\b(i have|i've got|i('m| am) having|i('m| am) experiencing|i('m| am) suffering from|i came (in |here )?for|i need help with|it('s| is) my)\b/g, '')
    .replace(/\b(a bit of|some|quite a bit of|very bad|terrible|awful)\b/g, '')
    .trim();

  // Must be at least 3 characters and not a pure number
  if (cleaned.length >= 3 && !/^\d+$/.test(cleaned)) {
    // Capitalise first letter
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return null;
}

function extractSymptoms(norm: string, complaint: string): string | null {
  // Any substantive message after complaint is collected = symptoms description
  // Minimum 5 words to avoid yes/no answers being saved as symptoms
  const words = norm.split(' ').filter(Boolean);
  if (words.length >= 5) {
    return norm.charAt(0).toUpperCase() + norm.slice(1);
  }
  // Short but specific — "since yesterday" / "for 3 days" counts
  if (/\b(since|for \d+|started|began|worse|better|constant|sharp|dull|throbbing)\b/.test(norm)) {
    return norm.charAt(0).toUpperCase() + norm.slice(1);
  }
  return null;
}

function extractDate(norm: string): string | null {
  // Tomorrow
  if (/\b(tomorrow)\b/.test(norm)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }
  // Day names: "Monday", "next Monday"
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  for (let i = 0; i < days.length; i++) {
    if (norm.includes(days[i])) {
      const today = new Date().getDay();
      let diff = i - today;
      if (diff <= 0) diff += 7;
      const d = new Date();
      d.setDate(d.getDate() + diff);
      return d.toISOString().split('T')[0];
    }
  }
  // DD/MM or DD-MM or "15th" / "the 15th"
  const dateMatch = norm.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/) ||
                    norm.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (dateMatch) {
    const day = parseInt(dateMatch[1]);
    const month = dateMatch[2] ? parseInt(dateMatch[2]) - 1 : new Date().getMonth();
    if (day >= 1 && day <= 31) {
      const d = new Date();
      d.setDate(day);
      d.setMonth(month);
      return d.toISOString().split('T')[0];
    }
  }
  return null;
}

function extractTime(norm: string): string | null {
  // "10am", "10:30am", "10:30", "10 am", "morning", "afternoon"
  const timeMatch = norm.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1]);
    const min = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const period = timeMatch[3];
    if (period === 'pm' && hour < 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23) {
      return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }
  if (/\b(morning)\b/.test(norm)) return '09:00';
  if (/\b(afternoon)\b/.test(norm)) return '14:00';
  if (/\b(evening)\b/.test(norm)) return '17:00';
  return null;
}

// ─── LAYER 4: ESCALATION DETECTOR ─────────────────────────────────────────────

/**
 * Detects escalation triggers from intent and message content.
 * Returns the escalation reason string matching our EscalationReason enum,
 * or null if no escalation is needed.
 */
function detectEscalation(
  intent: Intent,
  norm: string
): { escalate: boolean; reason: string | null } {
  if (intent === 'ESCALATION_TRIGGER') {
    // Determine which type
    if (/\b(chest|breathe|breathing|heart|stroke|seizure|collapse|emergency|bleeding)\b/.test(norm)) {
      return { escalate: true, reason: 'URGENT_MEDICAL' };
    }
    if (/\b(insurance|hmo|nhis|pay|billing|invoice)\b/.test(norm)) {
      return { escalate: true, reason: 'BILLING_DISPUTE' };
    }
    if (/\b(ridiculous|unacceptable|sue|furious|disgusted|worst|disgrace|livid)\b/.test(norm)) {
      return { escalate: true, reason: 'PATIENT_ANGRY' };
    }
    return { escalate: true, reason: 'MANUAL' };
  }
  return { escalate: false, reason: null };
}

// ─── LAYER 5: STATE MACHINE ───────────────────────────────────────────────────

/**
 * Determines the next conversation state based on current state,
 * intent, and what data has been collected so far.
 *
 * States:
 *   START → MENU (on any first message)
 *   MENU → COLLECTING_DETAILS (on mode selection)
 *   COLLECTING_DETAILS → COLLECTING_SYMPTOMS (once name/age/gender/complaint collected)
 *   COLLECTING_SYMPTOMS → COMPLETE (once symptoms collected)
 *   COMPLETE → IDLE (after confirmation sent)
 *   IDLE → MENU (on restart or new session trigger)
 */
function advanceState(
  currentState: string,
  intent: Intent,
  data: Partial<IntakeData>
): string {
  if (intent === 'RESTART') return 'MENU';
  if (intent === 'QUEUE_CHECK') return currentState; // State doesn't change

  switch (currentState) {
    case 'START':
    case 'IDLE':
      return 'MENU';

    case 'MENU':
      if (['WALKIN', 'APPOINTMENT', 'ON_MY_WAY'].includes(intent)) {
        return 'COLLECTING_DETAILS';
      }
      if (intent === 'GREETING' || intent === 'UNKNOWN') return 'MENU';
      return currentState;

    case 'COLLECTING_DETAILS':
      // Advance when name, age, gender, and complaint are all present
      if (data.name && data.age && data.gender && data.complaint) {
        return 'COLLECTING_SYMPTOMS';
      }
      return 'COLLECTING_DETAILS';

    case 'COLLECTING_SYMPTOMS':
      if (data.symptoms) {
        // If appointment mode, need date and time too
        if (data.mode === 'appointment') {
          if (!data.appointmentDate) return 'COLLECTING_APPOINTMENT_DATE';
          if (!data.appointmentTime) return 'COLLECTING_APPOINTMENT_TIME';
        }
        return 'COMPLETE';
      }
      return 'COLLECTING_SYMPTOMS';

    case 'COLLECTING_APPOINTMENT_DATE':
      if (data.appointmentDate) return 'COLLECTING_APPOINTMENT_TIME';
      return 'COLLECTING_APPOINTMENT_DATE';

    case 'COLLECTING_APPOINTMENT_TIME':
      if (data.appointmentTime) return 'COMPLETE';
      return 'COLLECTING_APPOINTMENT_TIME';

    case 'COMPLETE':
      return 'IDLE';

    default:
      return 'MENU';
  }
}

// ─── LAYER 6: RESPONSE SELECTOR ───────────────────────────────────────────────

/**
 * Selects Zero's reply based on next state and what's still missing.
 *
 * Responses are pre-written in Zero's voice — warm, direct, no emoji.
 * Each response is a function so it can reference clinic config and
 * patient data dynamically while remaining fully deterministic.
 *
 * When the same field has been asked for twice with no successful
 * extraction (stubCount >= 2), Zero escalates rather than asking again.
 */
function selectResponse(
  nextState: string,
  intent: Intent,
  data: Partial<IntakeData>,
  clinic: Clinic,
  stubCount: number
): { reply: string; shouldEscalate?: boolean } {

  // If we've been stuck on the same field twice, escalate
  if (stubCount >= 2) {
    return {
      reply: `I'm having trouble understanding — let me connect you with a member of our team who can help directly.`,
      shouldEscalate: true,
    };
  }

  // Queue check — can happen from any state
  if (intent === 'QUEUE_CHECK') {
    return {
      reply: data.name
        ? `I can see you're registered, ${data.name}. The clinic staff will call you when it's your turn.`
        : `You'll need to register first before I can check your queue position. Would you like to do that now?`,
    };
  }

  // Cancel
  if (intent === 'CANCEL') {
    return {
      reply: `No problem. If you need anything else, just send a message and I'll be right here.`,
    };
  }

  switch (nextState) {
    case 'MENU':
      return {
        reply: `Hello! Welcome to ${clinic.name}. I'm Zero, your AI assistant.\n\nHow can I help you today?\n\n1. Walk-in — join today's queue\n2. Book an appointment\n3. I'm on my way\n4. Check my queue number`,
      };

    case 'COLLECTING_DETAILS':
      // Ask for the next missing field in priority order
      if (!data.name) {
        return { reply: `Great. I'll get you sorted quickly. What's your full name?` };
      }
      if (!data.age) {
        return { reply: `Thanks ${data.name}. How old are you?` };
      }
      if (!data.gender) {
        return { reply: `And your gender — Male, Female, or Prefer not to say?` };
      }
      if (!data.complaint) {
        return { reply: `What brings you in today, ${data.name}?` };
      }
      return { reply: `Understood. Can you tell me a bit more about what you're experiencing?` };

    case 'COLLECTING_SYMPTOMS':
      return {
        reply: `Can you describe your ${data.complaint?.toLowerCase()} in a bit more detail? When did it start, and how would you describe the severity?`,
      };

    case 'COLLECTING_APPOINTMENT_DATE':
      return {
        reply: `What date would you like to come in? You can say something like "tomorrow", "Monday", or give me a specific date.`,
      };

    case 'COLLECTING_APPOINTMENT_TIME':
      return {
        reply: `What time works best for you? Morning, afternoon, or a specific time like 10am?`,
      };

    case 'COMPLETE': {
      const mode = data.mode;
      if (mode === 'walkin') {
        return {
          reply: `You're all set, ${data.name}. You've been added to today's queue. The clinic team will call you when it's your turn. Please have a seat.`,
        };
      }
      if (mode === 'appointment') {
        return {
          reply: `Perfect. Your appointment request has been submitted for ${data.appointmentDate} at ${data.appointmentTime}, ${data.name}. The clinic will confirm shortly.`,
        };
      }
      if (mode === 'onmyway') {
        return {
          reply: `Got it, ${data.name}. We've let the clinic know you're on your way. See you soon.`,
        };
      }
      return { reply: `You're all set, ${data.name}. The clinic team will be with you shortly.` };
    }

    default:
      return {
        reply: `Hello! Welcome to ${clinic.name}. How can I help you today?\n\n1. Walk-in — join today's queue\n2. Book an appointment\n3. I'm on my way\n4. Check my queue number`,
      };
  }
}

// ─── UTILITY ──────────────────────────────────────────────────────────────────

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

// ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────

/**
 * processMessage — the single public function the webhook handler calls.
 *
 * Takes the patient's message, current conversation state, and clinic config.
 * Returns what Zero should say and what was extracted.
 *
 * Entirely synchronous in its logic — no await, no external calls.
 * The async signature is kept for interface compatibility with the
 * webhook handler (which may need to make async calls around this).
 */
export async function processMessage(
  message: string,
  state: AiConversationState,
  clinic: Clinic
): Promise<BrainResult> {
  logger.info(`Brain state debug — state: ${state.state}, data keys: ${Object.keys(state.data).join(',')}, msg: ${message.slice(0,30)}`);

  try {
    // Track how many consecutive messages failed to extract any data.
    // Stored in state so it persists across turns.
    const stubCount = (state as any).stubCount || 0;

    // Layer 1: Normalise
    const norm = normalise(message);

    // Layer 2: Classify intent
    const intent = classifyIntent(norm, state);

    // Layer 3: Extract entities
    const extracted = extractEntities(message, state.state, state.data);

    // Layer 4: Detect escalation
    const { escalate, reason } = detectEscalation(intent, norm);
    if (escalate) {
      return {
        reply: `This sounds like something our team needs to handle directly. I'm flagging this conversation right now — someone will be with you shortly.`,
        extracted,
        isComplete: false,
        escalate: true,
        escalationReason: reason,
      };
    }

    // Merge newly extracted data with existing collected data
    const mergedData = { ...state.data, ...extracted };

    // Set mode if intent provides it
    if (intent === 'WALKIN') mergedData.mode = 'walkin';
    if (intent === 'APPOINTMENT') mergedData.mode = 'appointment';
    if (intent === 'ON_MY_WAY') mergedData.mode = 'onmyway';

    // Track stubs — if nothing was extracted and state didn't change
    const nothingExtracted = Object.keys(extracted).length === 0;
    const newStubCount = nothingExtracted && state.state === advanceState(state.state, intent, mergedData)
      ? stubCount + 1
      : 0;

    // Layer 5: Advance state machine
    const nextState = advanceState(state.state, intent, mergedData);
    const isComplete = nextState === 'COMPLETE';

    // Layer 6: Select response
    const { reply, shouldEscalate } = selectResponse(
      nextState,
      intent,
      mergedData,
      clinic,
      newStubCount
    );

    if (shouldEscalate) {
      return {
        reply,
        extracted,
        isComplete: false,
        escalate: true,
        escalationReason: 'MANUAL',
      };
    }

    // Update stubCount in state for next turn
    (state as any).stubCount = newStubCount;

    logger.info('Brain processed message', {
      clinicId: clinic.id,
      intent,
      nextState,
      extractedFields: Object.keys(extracted),
    });

    return {
      reply,
      extracted,
      isComplete,
      escalate: false,
      escalationReason: null,
    };

  } catch (err) {
    logger.error('Brain error', { error: (err as Error).message });
    return {
      reply: `Sorry, something went wrong on my end. Could you send that again?`,
      extracted: {},
      isComplete: false,
      escalate: false,
      escalationReason: null,
    };
  }
}

export function getNextState(
  currentState: string,
  message: string,
  mergedData: Partial<any>
): string {
  const norm = normalise(message);
  const stateObj = { state: currentState } as AiConversationState;
  const intent = classifyIntent(norm, stateObj);
  return advanceState(currentState, intent, mergedData);
}
