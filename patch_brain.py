import re

with open('src/services/zero-ai/brain.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. IntakeData interface
content = re.sub(
    r"  mode: 'walkin' \| 'appointment' \| 'onmyway' \| 'queue_check';",
    "  mode: 'walkin' | 'appointment' | 'onmyway' | 'queue_check';\n  confirmed?: boolean;",
    content
)

# 2. getNextState updates
next_state_orig = """    case 'COLLECTING_SYMPTOMS': {
      const followUpCount = data.followUpCount || 0;
      if (data.symptoms && followUpCount >= 2) {
        if (data.mode === 'appointment') {
          if (!data.appointmentDate) return 'COLLECTING_APPOINTMENT_DATE';
          if (!data.appointmentTime) return 'COLLECTING_APPOINTMENT_TIME';
        }
        return 'COMPLETE';
      }
      return 'COLLECTING_SYMPTOMS';
    }"""
next_state_new = """    case 'COLLECTING_SYMPTOMS': {
      const followUpCount = data.followUpCount || 0;
      if (data.symptoms && followUpCount >= 2) {
        if (data.mode === 'appointment') {
          if (!data.appointmentDate) return 'COLLECTING_APPOINTMENT_DATE';
          if (!data.appointmentTime) return 'COLLECTING_APPOINTMENT_TIME';
        }
        // Walk-in goes to confirmation before queue
        if (data.mode === 'walkin') return 'AWAITING_CONFIRMATION';
        return 'COMPLETE';
      }
      return 'COLLECTING_SYMPTOMS';
    }

    case 'AWAITING_CONFIRMATION': {
      // Patient said yes — move to COMPLETE
      const norm = (data as any)._lastMessage || '';
      if (/^(yes|yeah|yep|correct|right|confirm|ok|okay|sure|yh)$/i.test(norm)) {
        return 'COMPLETE';
      }
      // Patient wants to correct something — stay and let Gemini handle
      return 'AWAITING_CONFIRMATION';
    }"""
content = content.replace(next_state_orig, next_state_new)

# 3. systemPrompt
prompt_orig = """  const systemPrompt = `You are Zero, a warm and professional AI clinic assistant for ${clinic.name}.

Your ONLY jobs in this message:
1. Extract any patient data fields present in the message
2. Write the reply specified in the INSTRUCTION below

STRICT RULES:
- Follow the INSTRUCTION exactly — do not deviate from what it asks
- Be warm, empathetic, and professional
- Use the patient's first name if known — never repeat it excessively
- Format for WhatsApp: use *bold* for emphasis, keep messages concise
- Never ask for information already collected
- Never invent symptoms or data the patient did not provide
- No emoji unless the instruction specifies them

CRITICAL RULES:
- You are NEVER allowed to say the patient has been registered,
  added to a queue, or that their appointment is booked UNLESS
  the INSTRUCTION explicitly says to confirm registration.
- NEVER assume the patient is unwell, sick, or "not feeling
  their best" unless they have explicitly described symptoms.
  Do not add empathy for illness before symptoms are shared.
- If the INSTRUCTION asks you to ask for a specific field,
  ask ONLY for that field. Do not ask for other fields in
  the same message.
- NEVER combine multiple questions in one reply.
- NEVER start two consecutive replies with "Thank you".
  Vary your acknowledgements naturally. Use phrases like
  "Got it", "Understood", "I see", "Perfect", "Great" —
  or skip the acknowledgement entirely and move straight
  to the next question. A real receptionist does not say
  "Thank you" before every single response.
- Do not use filler phrases that add no information:
  "It is a pleasure to assist you", "I am here to help",
  "Allow me to assist you with that". Go straight to the
  point.
- Match the patient's energy. If they are brief, be brief.
  If they volunteer detail, acknowledge it naturally once
  then move forward.

RESPOND ONLY WITH THIS JSON — no markdown, no explanation:
{
  "reply": "your WhatsApp message",
  "extracted": {
    "name": null,
    "age": null,
    "gender": null,
    "complaint": null,
    "symptoms": null,
    "appointmentDate": null,
    "appointmentTime": null
  }
}
Only include extracted fields you actually found. Never guess.`;"""

prompt_new = """  const systemPrompt = `You are Zero, the AI patient assistant for ${clinic.name}.
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
  - NEVER assume the patient is unwell before they say so.

  CRITICAL RULES:
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
  }`;"""
content = content.replace(prompt_orig, prompt_new)

# 4. buildInstruction COMPLETE walkin
complete_orig = """    if (mode === 'walkin') {
      return `Intake is complete. Confirm registration with this exact format:\\n✅ *You're all set, ${data.name}.*\\n\\n🔢 Queue Number: *#${queuePlaceholder}*\\n🏥 Department: *${department}*\\n${urgencyEmoji} Urgency: *${urgency}*\\n\\nPlease take a seat at reception. I'll message you when it's your turn. 🙏\\n\\nDo not add or change anything. Extract no fields.`;
    }"""
complete_new = """    if (mode === 'walkin') {
      return `Intake confirmed. Assign the queue number now.
    Be warm. Use this format exactly:

    ✅ *You're all set, ${data.name}!*

    🔢 *Queue Number:* #${queuePlaceholder}
    🏥 *Department:* ${department}
    ${urgencyEmoji} *Urgency:* ${urgency}

    Please take a seat — I'll message you the moment
    it's your turn. 🙏`;
    }"""
content = content.replace(complete_orig, complete_new)

# 5. buildInstruction AWAITING_CONFIRMATION
menu_case_orig = """    case 'MENU':"""
awaiting_conf_new = """    case 'AWAITING_CONFIRMATION':
      if (data.mode === 'walkin') {
        const { department, urgency } = routeToDepAndUrgency(data);
        const urgencyEmoji = urgency === 'HIGH' ? '🔴'
          : urgency === 'MEDIUM' ? '🟡' : '🟢';
    
        return `Intake is complete. Before assigning the queue,
        warmly summarise what was collected and ask the patient
        to confirm everything is correct. Use this exact format
        for the summary — do not change the structure, only make
        the opening line warm and natural:
    
        Here is what I have for you, ${firstName}:
    
        👤 *Name:* ${data.name}
        🎂 *Age:* ${data.age}
        ⚕️ *Complaint:* ${data.complaint}
        🏥 *Department:* ${department}
        ${urgencyEmoji} *Urgency:* ${urgency}
    
        Is everything correct? Reply *Yes* to confirm or let me
        know what needs to be updated.
    
        If the patient is responding to a previous summary and wants to correct something, acknowledge what they said and ask for the correct information.
        Do not show the queue number yet — that happens next.`;
      }
      return `The patient is responding to the summary you showed them. If they confirmed (yes/correct/ok), tell them warmly that you are registering them now. If they want to correct something, acknowledge what they said and ask for the correct information. Do not show the queue number yet — that happens next.`;

    case 'MENU':"""
content = content.replace(menu_case_orig, awaiting_conf_new)

# 6. Symptom follow-up closing
symptom_closing_orig = """      return `Thank the patient. Ask: "Are you experiencing any other symptoms alongside this — like fever, fatigue, or anything else unusual?" Extract any additional symptoms mentioned.`;"""
symptom_closing_new = """      return `The patient has shared good detail. Show genuine
  warmth — acknowledge what they have been going through
  before asking one final question: are there any other
  symptoms they want to mention before you proceed?
  Make it feel like you are wrapping up with care, not
  rushing to close a form.`;"""
content = content.replace(symptom_closing_orig, symptom_closing_new)

with open('src/services/zero-ai/brain.ts', 'w', encoding='utf-8') as f:
    f.write(content)
