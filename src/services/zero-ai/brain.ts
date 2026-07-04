/**
 * Zero Hybrid Brain v2.0
 *
 * Architecture:
 *   Layer 1 — Normaliser: cleans raw WhatsApp input
 *   Layer 2 — Intent classifier: deterministic, pattern-based
 *   Layer 3 — Escalation detector: deterministic, keyword-based
 *   Layer 4 — State machine: deterministic, owns all flow decisions
 *   Layer 5 — Gemini: extracts entities + generates the reply text
 *   Layer 6 — Fallback: deterministic reply if Gemini fails
 *
 * Gemini is a text generation and extraction tool here.
 * It cannot change state, trigger escalation, or complete intake.
 * All of those decisions are made before Gemini is called.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { Clinic } from '@prisma/client';
import { AiConversationState } from '../../types';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY!);

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface BrainResult {
  reply: string;
  extracted: Partial<IntakeData>;
  isComplete: boolean;
  escalate: boolean;
  escalationReason: string | null;
  department?: string;
  urgency?: string;
}

export interface IntakeData {
  name: string;
  firstName: string;
  age: number;
  gender: string;
  complaint: string;
  symptoms: string;
  followUpCount: number;
  appointmentDate: string;
  appointmentTime: string;
  mode: 'walkin' | 'appointment' | 'onmyway' | 'queue_check';
  confirmed?: boolean;
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

function normalise(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── LAYER 2: INTENT CLASSIFIER ───────────────────────────────────────────────

function classifyIntent(text: string, state: AiConversationState): Intent {
  // Escalation first — highest priority
  if (matchesAny(text, ESCALATION_PATTERNS)) return 'ESCALATION_TRIGGER';

  // Explicit commands
  if (matchesAny(text, RESTART_PATTERNS)) return 'RESTART';
  if (matchesAny(text, CANCEL_PATTERNS)) return 'CANCEL';
  if (matchesAny(text, QUEUE_CHECK_PATTERNS)) return 'QUEUE_CHECK';

  // Number selections — handle before anything else at menu states
  if (['START', 'MENU', 'IDLE'].includes(state.state)) {
    if (/^[1１]$/.test(text.trim())) return 'WALKIN';
    if (/^[2２]$/.test(text.trim())) return 'APPOINTMENT';
    if (/^[3３]$/.test(text.trim())) return 'ON_MY_WAY';
    if (/^[4４]$/.test(text.trim())) return 'QUEUE_CHECK';
    if (matchesAny(text, WALKIN_PATTERNS)) return 'WALKIN';
    if (matchesAny(text, APPOINTMENT_PATTERNS)) return 'APPOINTMENT';
    if (matchesAny(text, ON_MY_WAY_PATTERNS)) return 'ON_MY_WAY';
    if (matchesAny(text, GREETING_PATTERNS)) return 'GREETING';
  }

  // Mid-conversation — patient is providing data
  if (!['START', 'MENU', 'IDLE', 'COMPLETE'].includes(state.state)) {
    return 'PROVIDING_DATA';
  }

  if (matchesAny(text, GREETING_PATTERNS)) return 'GREETING';
  return 'UNKNOWN';
}

const GREETING_PATTERNS = [
  /^(hi|hello|hey|good\s*(morning|afternoon|evening)|hiya|yo)[\s!.,]*$/,
];
const WALKIN_PATTERNS = [
  /\b(walk.?in|join queue|register|check in|i('m| am) here|i want to see|i need to see)\b/,
];
const APPOINTMENT_PATTERNS = [
  /\b(book|appointment|schedule|reserve|i('d| would) like to book)\b/,
];
const ON_MY_WAY_PATTERNS = [
  /\b(on my way|omw|coming|heading|leaving|en route|almost there)\b/,
];
const QUEUE_CHECK_PATTERNS = [
  /\b(queue|my (number|turn|position)|how long|when.*my turn)\b/,
];
const RESTART_PATTERNS = [/^(restart|start over|reset|menu|main menu)[\s.]*$/];
const CANCEL_PATTERNS = [/\b(cancel|never mind|forget it|stop)\b/];
const ESCALATION_PATTERNS = [
  /\b(chest (pain|tightness|pressure)|heart (pain|attack)|can't breathe|difficulty breathing)\b/,
  /\b(stroke|unconscious|collapse|seizure|severe bleeding|emergency)\b/,
  /\b(coughing (with|and) (blood|heart|chest pain))\b/,
  /\b(i (want to|will) sue|i'm (furious|livid|disgusted)|worst (clinic|service))\b/,
  /\b(insurance|hmo|nhis|billing (error|dispute)|refuse to pay)\b/,
];

// ─── LAYER 3: ESCALATION DETECTOR ─────────────────────────────────────────────

function detectEscalation(
  intent: Intent,
  norm: string
): { escalate: boolean; reason: string | null } {
  if (intent !== 'ESCALATION_TRIGGER') return { escalate: false, reason: null };

  if (/\b(chest|heart|breathe|stroke|seizure|collapse|bleeding|emergency)\b/.test(norm)) {
    return { escalate: true, reason: 'URGENT_MEDICAL' };
  }
  if (/\b(insurance|hmo|nhis|pay|billing)\b/.test(norm)) {
    return { escalate: true, reason: 'BILLING_DISPUTE' };
  }
  if (/\b(sue|furious|livid|disgusted|worst)\b/.test(norm)) {
    return { escalate: true, reason: 'PATIENT_ANGRY' };
  }
  return { escalate: true, reason: 'MANUAL' };
}

// ─── LAYER 4: STATE MACHINE ───────────────────────────────────────────────────

export function getNextState(
  currentState: string,
  intent: Intent,
  data: Partial<IntakeData>
): string {
  if (intent === 'RESTART') return 'MENU';
  if (intent === 'QUEUE_CHECK') return currentState;

  switch (currentState) {
    case 'START':
    case 'IDLE':
      return 'MENU';

    case 'MENU':
      if (['WALKIN', 'APPOINTMENT', 'ON_MY_WAY'].includes(intent)) {
        return 'COLLECTING_DETAILS';
      }
      return 'MENU';

    case 'COLLECTING_DETAILS':
      if (data.name && data.age && data.gender && data.complaint) {
        return 'COLLECTING_SYMPTOMS';
      }
      return 'COLLECTING_DETAILS';

    case 'COLLECTING_SYMPTOMS': {
      const followUpCount = (data as any).followUpCount || 0;
      if (data.symptoms && followUpCount >= 1) {
        if (data.mode === 'appointment') {
          if (!data.appointmentDate) return 'COLLECTING_APPOINTMENT_DATE';
          if (!data.appointmentTime) return 'COLLECTING_APPOINTMENT_TIME';
        }
        if (data.mode === 'walkin') return 'AWAITING_CONFIRMATION';
        return 'COMPLETE';
      }
      return 'COLLECTING_SYMPTOMS';
    }

    case 'AWAITING_CONFIRMATION':
      return currentState;

    case 'COLLECTING_APPOINTMENT_DATE':
      return data.appointmentDate ? 'COLLECTING_APPOINTMENT_TIME' : currentState;

    case 'COLLECTING_APPOINTMENT_TIME':
      return data.appointmentTime ? 'COMPLETE' : currentState;

    case 'COMPLETE':
      return 'IDLE';

    default:
      return 'MENU';
  }
}

// ─── LAYER 5A: DEPARTMENT + URGENCY ROUTING ───────────────────────────────────

function routeToDepAndUrgency(data: Partial<IntakeData>): {
  department: string;
  urgency: string;
} {
  const combined = ((data.complaint || '') + ' ' + (data.symptoms || '')).toLowerCase();

  const isHighUrgency = /\b(chest pain|heart pain|can't breathe|difficulty breathing|shortness of breath|fainted|fainting|passed out|blacked out|unconscious|collapsed|collapse|stroke|seizure|spreading to arm|spreading to jaw)\b/.test(combined);

  const urgency = isHighUrgency
    ? 'HIGH'
    : /\b(fever|vomiting|blood|fracture|broken)\b/.test(combined)
    ? 'MEDIUM'
    : 'LOW';

  let department = 'General';
  if (/\b(chest|heart|cardiac|cardio|palpitation)\b/.test(combined)) department = 'Cardiology';
  else if (/\b(tooth|teeth|dental|gum|jaw|brace|orthodon)\b/.test(combined)) department = 'Dental';
  else if (/\b(faint|dizz|vertigo|balance|coordination|numb|tingle|seizure|memory|confusion)\b/.test(combined)) department = 'Neurology';
  else if (/\b(head|migraine|neuro|seizure|memory|stroke|nerve)\b/.test(combined)) department = 'Neurology';
  else if (/\b(skin|rash|acne|itch|derma|eczema)\b/.test(combined)) department = 'Dermatology';
  else if (/\b(physio|joint|muscle|back|knee|shoulder|spine)\b/.test(combined)) department = 'Physiotherapy';
  else if (/\b(eye|vision|ear|hearing|nose|throat|ent|sinus)\b/.test(combined)) department = 'ENT';
  else if (/\b(stomach|abdomen|nausea|vomit|diarrhea|digest|bowel)\b/.test(combined)) department = 'Gastroenterology';
  else if (/\b(lab|test|blood test|urine|sample|check.?up)\b/.test(combined)) department = 'Laboratory';

  return { department, urgency };
}

// ─── FIRST NAME EXTRACTION ────────────────────────────────────────────────────

function extractFirstName(fullName: string): string {
  const HONORIFICS = new Set(['mr','mrs','miss','ms','dr','prof','rev','chief','barr','engr','arc']);
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return fullName;
  const firstLower = parts[0].replace('.', '').toLowerCase();
  if (HONORIFICS.has(firstLower)) {
    // Use "Dr. Damodred" — title + last name
    const title = parts[0].replace('.', '') + '.';
    const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
    return `${title} ${lastName}`.trim();
  }
  return parts[0];
}

// ─── LAYER 5B: GEMINI — ENTITY EXTRACTION + REPLY GENERATION ─────────────────

/**
 * Calls Gemini with a tightly scoped prompt.
 * Gemini's only job: extract data fields and write a warm reply.
 * The state, next question, and completion logic are decided before
 * this call and passed in as instructions — Gemini cannot override them.
 */
async function callGemini(
  message: string,
  history: { role: 'user' | 'model'; content: string }[],
  instruction: string,
  clinic: Clinic
): Promise<{ reply: string; extracted: Partial<IntakeData> }> {
  const systemPrompt = `You are Zero, the AI patient assistant for ${clinic.name}.
  You are warm, attentive, and calm — like a trusted friend
  who works at the clinic. Think Baymax: caring, gentle,
  never rushing, always making the patient feel heard.

  YOUR PERSONALITY:
  - Warm but efficient. You genuinely care about every patient.
  - You acknowledge what people share before moving forward.
    A patient who tells you something personal deserves a
    human response, not just a data collection prompt.
  - You are sensitive to embarrassing or difficult topics.
    Handle them with extra care and zero judgment.
  - You vary your language constantly. You never say the same
    phrase twice in the same conversation.
  - You are brief. One thought per message. Never combine
    two questions.

  TONE RULES — read these carefully:
  - "Thank you" maximum once per conversation. After that,
    use: "Got it", "I see", "Noted", "Right", "Perfect",
    "Understood" — pick what fits the moment.
  - "I am sorry to hear that" maximum once per conversation.
    After that, show empathy through action, not the phrase.
  - NEVER say: "It is a pleasure to assist you", "I am here
    to help", "Allow me to assist", "How may I assist you".
    These are filler. Go straight to what matters.
  - Match the patient's energy. Brief patient → be concise.
    Patient who shares a lot → acknowledge before asking.
  - For sensitive topics (sexual health, mental health,
    personal struggles): lead with warmth and zero judgment
    before asking any question.
  - ABSOLUTE RULE: Do NOT express sympathy for illness,
    pain, or discomfort until the patient has explicitly
    described a symptom in their own words. Saying "I'm
    sorry to hear you've been feeling unwell" before the
    patient mentions any symptom is a violation of patient
    trust. Wait. Listen first.
  - When a patient provides a name with a title (Dr., Mrs.,
    Mr., Prof.), ALWAYS address them using their title and
    last name. NEVER drop the title or use only the first
    name. "Dr. Damodred", "Mrs. Okonkwo", "Prof. Williams".

  CRITICAL RULES:
  - NEVER ask for information that already exists in the
    INSTRUCTION context or in the conversation history.
    If the INSTRUCTION shows the patient's name, age, or
    any other field — those are already collected. Do not
    ask for them again under any circumstances.
  - Follow the INSTRUCTION exactly. If it says ask for name,
    ask for name and nothing else.
  - NEVER claim registration is complete, queue is assigned,
    or appointment is booked unless the INSTRUCTION explicitly
    says to do so.
  - NEVER combine two questions in one message.
  - Extract only data the patient actually provided.
    Never guess or infer unstated fields.
  - Do not start consecutive replies with the same word.

  RESPOND ONLY WITH THIS JSON — no markdown, no explanation:
  {
    "reply": "your WhatsApp message to the patient",
    "extracted": {
      "name": null, "age": null, "gender": null,
      "complaint": null, "symptoms": null,
      "appointmentDate": null, "appointmentTime": null
    }
  }`;

  const model = genAI.getGenerativeModel({
    model: 'gemini-3.1-flash-lite',
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.4,
      maxOutputTokens: 2048,
    },
  });

  // Last 6 turns of history for context
  const contents = [
    ...history.slice(-6).map((h) => ({
      role: h.role as 'user' | 'model',
      parts: [{ text: h.content }],
    })),
    {
      role: 'user' as const,
      parts: [{ text: `INSTRUCTION: ${instruction}\n\nPATIENT MESSAGE: ${message}` }],
    },
  ];

  const result = await model.generateContent({ contents });
  const rawText = result.response.text();

  // Extract JSON object from response — find the first { and
  // last } and take everything between them
  const jsonStart = rawText.indexOf('{');
  const jsonEnd = rawText.lastIndexOf('}');

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new Error(`No valid JSON object found in Gemini response: ${rawText.slice(0, 100)}`);
  }

  const raw = rawText.slice(jsonStart, jsonEnd + 1);

  const parsed = JSON.parse(raw);

  // Clean extracted — remove nulls, coerce age to number
  const extracted: Partial<IntakeData> = {};
  for (const [key, val] of Object.entries(parsed.extracted || {})) {
    if (val !== null && val !== undefined && val !== '') {
      if (key === 'age') {
        const n = parseInt(String(val));
        if (!isNaN(n) && n > 0 && n < 120) (extracted as any)[key] = n;
      } else {
        (extracted as any)[key] = val;
      }
    }
  }

  // Derive firstName if name was just extracted
  if (extracted.name && !extracted.firstName) {
    (extracted as any).firstName = extractFirstName(extracted.name as string);
  }

  return { reply: parsed.reply || '', extracted };
}

// ─── VALIDATION ─────────────────────────────────────────────────────────────────

function validateGeminiReply(
  reply: string,
  nextState: string,
  isComplete: boolean
): boolean {
  if (isComplete) return true; // Always allow completion replies

  const replyLower = reply.toLowerCase();

  // Only block replies that explicitly claim registration/booking
  // is done when we haven't reached COMPLETE state
  const definiteCompletionPhrases = [
    'added you to the queue',
    'added to the queue',
    'successfully registered',
    'registration is complete',
    'you are all set',
    "you're all set",
    'appointment has been booked',
    'appointment is confirmed',
    'appointment request submitted',
    'booked your appointment',
    'your queue number is',
  ];

  for (const phrase of definiteCompletionPhrases) {
    if (replyLower.includes(phrase)) {
      return false;
    }
  }

  return true;
}

// ─── LAYER 6: DETERMINISTIC FALLBACK ─────────────────────────────────────────

/**
 * Used when Gemini fails. Keeps Zero alive and the conversation moving.
 * Not as warm as Gemini but never wrong about what to ask next.
 */
function fallbackReply(
  nextState: string,
  data: Partial<IntakeData>,
  clinic: Clinic
): string {
  const firstName = (data as any).firstName || data.name || 'there';

  switch (nextState) {
    case 'AWAITING_CONFIRMATION': {
      if (data.mode === 'walkin') {
        const { department, urgency } = routeToDepAndUrgency(data);
        const displayComplaint = data.complaint || (data as any).symptoms || 'Not recorded';
        return `Here is what I have for you, ${firstName}:\n\n*Name:* ${data.name}\n*Age:* ${data.age}\n*Complaint:* ${displayComplaint}\n*Department:* ${department}\n*Urgency:* ${urgency}\n\nIs everything correct? Reply *Yes* to confirm or let me know what needs to be updated.`;
      }
      return `Please reply *Yes* to confirm your details or let me know what you want to change.`;
    }
    case 'MENU':
      return `Hello! Welcome to *${clinic.name}*. I'm *Zero*, your AI clinic assistant. 👋\n\nHow can I help you today?\n\n1️⃣ Walk-in — join today's queue\n2️⃣ Book an appointment\n3️⃣ I'm on my way to the clinic\n4️⃣ Check my queue number`;
    case 'COLLECTING_DETAILS':
      if (!data.name) return `What's your *full name*?`;
      if (!data.age) return `Thanks *${firstName}*. How old are you?`;
      if (!data.gender) return `And your gender — *Male*, *Female*, or *Prefer not to say*?`;
      return `What brings you to *${clinic.name}* today, ${firstName}?`;
    case 'COLLECTING_SYMPTOMS':
      return `Can you describe your symptoms in more detail — how long have you had this and how severe is it?`;
    case 'COLLECTING_APPOINTMENT_DATE':
      return `What date would you like to come in?`;
    case 'COLLECTING_APPOINTMENT_TIME':
      return `What time works best for you?`;
    case 'IDLE':
      return `You are all set, ${firstName}. Please take a
    seat and we will call you when it is your turn. 🙏`;
    default:
      return `Could you say that again? I want to make sure I help you correctly.`;
  }
}

// ─── BUILD GEMINI INSTRUCTION ─────────────────────────────────────────────────

/**
 * Tells Gemini exactly what to do based on the current state
 * and what data is still missing. Gemini follows this instruction
 * to generate the reply — it does not decide this itself.
 */
function buildInstruction(
  nextState: string,
  data: Partial<IntakeData>,
  clinic: Clinic,
  isComplete: boolean,
  queuePlaceholder?: number
): string {
  const firstName = (data as any).firstName || data.name || 'the patient';
  const clinicName = clinic.name;

  if (isComplete) {
    const { department, urgency } = routeToDepAndUrgency(data);
    const today = new Date().toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
    const mode = data.mode;
    if (mode === 'walkin') {
      return `Registration confirmed. Send this exact message
  with no additions or changes:

You are all set, *${data.name}*.

*Queue Number:* #${queuePlaceholder}
*Name:* ${data.name}
*Date:* ${today}
*Department:* ${department}

Please take a seat — I will message you the moment it is
your turn. 🙏

Do not add urgency. Do not add any other text.
Do not say you are processing or submitting anything.
This is the final message of the intake flow.`;
    }
    if (mode === 'appointment') {
      return `Appointment booked. Confirm with this format:\n✅ *Appointment request submitted, ${data.name}.*\n\n📅 Date: *${data.appointmentDate}*\n⏰ Time: *${data.appointmentTime}*\n🏥 Service: *${data.complaint}*\n\nThe clinic will confirm shortly. 🙏\n\nDo not add or change anything.`;
    }
    return `Patient is on their way. Send a warm confirmation that ${clinicName} has been notified and you'll see them soon.`;
  }

  switch (nextState) {
    case 'AWAITING_CONFIRMATION':
      if (data.mode === 'walkin') {
        const { department, urgency } = routeToDepAndUrgency(data);
        const displayComplaint = data.complaint || (data as any).symptoms || 'Not recorded';
        return `Intake is complete. Before assigning the queue,
        warmly summarise what was collected and ask the patient
        to confirm everything is correct. Use this exact format
        for the summary — do not change the structure, only make
        the opening line warm and natural:
    
        Here is what I have for you, ${firstName}:
    
        *Name:* ${data.name}
        *Age:* ${data.age}
        *Complaint:* ${displayComplaint}
        *Department:* ${department}
        *Urgency:* ${urgency}
    
        Is everything correct? Reply *Yes* to confirm or let me
        know what needs to be updated.
    
        If the patient is responding to a previous summary and wants to correct something, acknowledge what they said and ask for the correct information.
        Do not show the queue number yet — that happens next.`;
      }
      return `The patient is responding to the summary you showed them. If they confirmed (yes/correct/ok), tell them warmly that you are registering them now. If they want to correct something, acknowledge what they said and ask for the correct information. Do not show the queue number yet — that happens next.`;

    case 'MENU':
      return `Greet the patient warmly and show the clinic menu with these exact options:\n1️⃣ Walk-in — join today's queue\n2️⃣ Book an appointment\n3️⃣ I'm on my way to the clinic\n4️⃣ Check my queue number\n\nMention the clinic name *${clinicName}* and your name *Zero*.`;

    case 'COLLECTING_DETAILS':
      if (!data.name) {
        return `Ask for the patient's full name warmly. Extract their name from this message if present.`;
      }
      if (!data.age) {
        return `Thank the patient by their first name *${firstName}* and ask how old they are. Extract their age from this message if present.`;
      }
      if (!data.gender) {
        return `Ask the patient their gender — Male, Female, or Prefer not to say. Extract gender from this message if present.`;
      }
      return `Show empathy and ask what brings ${firstName} to *${clinicName}* today. Extract their complaint from this message if present.`;

    case 'COLLECTING_SYMPTOMS': {
      const followUpCount = data.followUpCount || 0;
      const complaint = (data.complaint || '').toLowerCase();

      if (followUpCount === 0 || !data.symptoms) {
        let medicalFollowUp = `How long have you had this and how severe is it on a scale of 1 to 10?`;
        if (/\b(chest|heart|cardiac)\b/.test(complaint)) {
          medicalFollowUp = `Is the pain sharp, crushing, or pressure-like? Does it spread to your arm or jaw?`;
        } else if (/\b(cough|breath|respiratory)\b/.test(complaint)) {
          medicalFollowUp = `Is the cough dry or producing mucus? Any fever or difficulty breathing at rest?`;
        } else if (/\b(head|migraine)\b/.test(complaint)) {
          medicalFollowUp = `Where exactly is the pain and does light or noise make it worse?`;
        } else if (/\b(stomach|abdomen|nausea|digest)\b/.test(complaint)) {
          medicalFollowUp = `Where in the abdomen? Is it constant or does it come and go? Any nausea or changes in appetite?`;
        } else if (/\b(tooth|dental|gum)\b/.test(complaint)) {
          medicalFollowUp = `Which area is affected? Any sensitivity to hot or cold, or swelling?`;
        } else if (/\b(back|knee|joint|muscle)\b/.test(complaint)) {
          medicalFollowUp = `Which area exactly? Did it start suddenly or gradually?`;
        }
        return `Show brief empathy for the patient's complaint. Ask: "${medicalFollowUp}". Extract symptoms from this message if present.`;
      }

      if (followUpCount === 1) {
        return `Thank the patient briefly. Ask: "Did this start suddenly or has it been building up gradually?" Extract any symptom details from this message.`;
      }

      return `The patient has shared good detail. Show genuine
  warmth — acknowledge what they have been going through
  before asking one final question: are there any other
  symptoms they want to mention before you proceed?
  Make it feel like you are wrapping up with care, not
  rushing to close a form.`;
    }

    case 'COLLECTING_APPOINTMENT_DATE':
      return `Ask the patient what date they would like to come in. Accept formats like "tomorrow", day names, or specific dates. Extract the appointment date from this message if present.`;

    case 'COLLECTING_APPOINTMENT_TIME':
      return `Ask the patient what time works best. Accept morning/afternoon/evening or specific times. Extract the appointment time from this message if present.`;

    case 'IDLE':
      return `The patient has been registered and is sending
    follow-up messages. Respond warmly and briefly —
    let them know they are all set and to take a seat.
    Do not restart the intake flow. Do not show the menu.`;

    default:
      return `Respond helpfully to the patient's message.`;
  }
}

// ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────

export async function processMessage(
  message: string,
  state: AiConversationState,
  clinic: Clinic,
  queueNumber?: number
): Promise<BrainResult> {
  try {
    const norm = normalise(message);

    // Layer 2: Intent
    const intent = classifyIntent(norm, state);

    // Layer 3: Escalation — checked before anything else
    const { escalate, reason } = detectEscalation(intent, norm);
    if (escalate) {
      // Still try to extract a name from the message for the patient record
      let escalationExtracted: Partial<IntakeData> = {};
      try {
        const { extracted } = await callGemini(
          message,
          state.history,
          `Extract only the patient name from this message if present. Do not reply with anything else.`,
          clinic
        );
        escalationExtracted = extracted;
      } catch { /* silent — escalation reply doesn't need extraction */ }

      return {
        reply: `⚠️ *This sounds urgent.* I'm flagging this conversation to our team right now.\n\nSomeone will be with you *immediately*. Please stay on this chat. 🙏`,
        extracted: escalationExtracted,
        isComplete: false,
        escalate: true,
        escalationReason: reason,
        urgency: 'HIGH',
        department: 'General',
      };
    }

    // Set mode from intent
    const modeUpdate: Partial<IntakeData> = {};
    if (intent === 'WALKIN') modeUpdate.mode = 'walkin';
    if (intent === 'APPOINTMENT') modeUpdate.mode = 'appointment';
    if (intent === 'ON_MY_WAY') modeUpdate.mode = 'onmyway';

    // Layer 4: Advance state machine with current data
    // (Gemini may extract more data, but we need the next state to build the instruction)
    const tentativeData = { ...state.data, ...modeUpdate };
    const nextState = getNextState(state.state, intent, tentativeData);
    const isComplete = nextState === 'COMPLETE';

    const { department, urgency } = routeToDepAndUrgency(tentativeData);

    // Layer 5: Call Gemini for extraction + reply generation
    let reply: string = '';
    let extracted: Partial<IntakeData> = modeUpdate;
    let mergedData: any = { ...tentativeData };
    let finalNextState: string = state.state;
    let finalIsComplete = false;

    // Pass 1: extraction only
    // Tell Gemini what's already collected so it doesn't
    // re-extract stale data or lose existing fields
    const extractionPrompt = `Current collected data:
    ${JSON.stringify(state.data)}

    Extract ONLY NEW fields from this patient message that
    are not already in the collected data above.
    Fields: name, age, gender, complaint, symptoms,
    appointmentDate, appointmentTime.
    Set reply to empty string "".
    Only include fields you actually found in this message.
    
    - "complaint" is what the patient says is wrong with them
      in their own words e.g. "skin rashes", "headache",
      "chest pain". It is NEVER "walk-in", "appointment", or
      any menu selection. Mode and complaint are different fields.`;

    try {
      const extractResult = await callGemini(
        message, state.history, extractionPrompt, clinic
      );
      // Merge: only take new non-null fields, never overwrite existing
      for (const [key, val] of Object.entries(extractResult.extracted)) {
        if (val !== null && val !== undefined && val !== '') {
          if (!(state.data as any)[key]) {
            (extracted as any)[key] = val;
          }
        }
      }
    } catch {
      // Extraction failed silently — continue with what we have
    }

    // Build mergedData preserving ALL existing data
    mergedData = { ...tentativeData, ...extracted };

    try {

      // Increment followUpCount when in symptom collection
      if (nextState === 'COLLECTING_SYMPTOMS' && (mergedData.symptoms || state.data.symptoms)) {
        const current = (tentativeData as any).followUpCount || 0;
        (mergedData as any).followUpCount = current + 1;
        (extracted as any).followUpCount = current + 1;
      }

      // Derive firstName if name newly extracted
      if (mergedData.name && !(mergedData as any).firstName) {
        (mergedData as any).firstName = extractFirstName(mergedData.name as string);
        (extracted as any).firstName = extractFirstName(mergedData.name as string);
      }

      // Step 3: Calculate the real next state
      finalNextState = getNextState(state.state, intent, mergedData);
      finalIsComplete = finalNextState === 'COMPLETE';

      // Step 4: Build the instruction for the reply
      // using mergedData so it knows what's already collected
      const instruction = buildInstruction(
        finalNextState, mergedData, clinic,
        finalIsComplete, queueNumber
      );

      // Step 5: Call Gemini again just for the reply
      const { reply: geminiReply } = await callGemini(
        message, state.history, instruction, clinic
      );

      if (validateGeminiReply(geminiReply, finalNextState, finalIsComplete)) {
        reply = geminiReply;
      } else {
        logger.warn('Gemini reply failed validation — using fallback', {
          reply: geminiReply.slice(0, 80),
          nextState: finalNextState,
        });
        reply = fallbackReply(finalNextState, mergedData, clinic);
      }

    } catch (geminiErr) {
      // Layer 6: Fallback if Gemini fails
      logger.warn(`Gemini failed: ${(geminiErr as Error).message} | ${(geminiErr as Error).stack?.split('\\n')[1]}`);
      extracted = modeUpdate;
      
      mergedData = { ...tentativeData, ...extracted };
      finalNextState = getNextState(state.state, intent, mergedData);
      finalIsComplete = finalNextState === 'COMPLETE';
      reply = fallbackReply(finalNextState, mergedData, clinic);
    }

    logger.info('Brain processed', {
      clinicId: clinic.id,
      intent,
      nextState: finalNextState,
      isComplete: finalIsComplete,
      extractedFields: Object.keys(extracted),
    });

    return {
      reply,
      extracted,
      isComplete: finalIsComplete,
      escalate: false,
      escalationReason: null,
      department,
      urgency,
    };

  } catch (err) {
    logger.error('Brain fatal error', { error: (err as Error).message });
    return {
      reply: `Sorry, something went wrong. Could you send that again?`,
      extracted: {},
      isComplete: false,
      escalate: false,
      escalationReason: null,
    };
  }
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}
