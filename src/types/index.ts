import { Request } from 'express';
import { StaffMember, Clinic } from '@prisma/client';

// Every authenticated route gets staff + clinic attached by auth middleware
export interface AuthenticatedRequest extends Request {
  staff: StaffMember;
  clinic: Clinic;
}

// AI conversation state stored in Conversation.aiState (JSON column)
export interface AiConversationState {
  state: 'START' | 'MENU' | 'COLLECTING_DETAILS' | 'COLLECTING_SYMPTOMS' | 'COLLECTING_APPOINTMENT_DATE' | 'COLLECTING_APPOINTMENT_TIME' | 'COMPLETE' | 'IDLE';
  data: Partial<{
    name: string; age: number; gender: string;
    complaint: string; symptoms: string;
    appointmentDate: string; appointmentTime: string;
    mode: 'walkin' | 'appointment' | 'onmyway' | 'queue_check';
  }>;
  history: { role: 'user' | 'model'; content: string }[];
}

// WhatsApp webhook — only the fields we actually use
export interface WhatsAppWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      field: string;
      value: {
        metadata: { phone_number_id: string; display_phone_number: string };
        contacts?: Array<{ profile: { name: string }; wa_id: string }>;
        messages?: Array<{
          from: string; id: string; timestamp: string; type: string;
          text?: { body: string };
          image?: { id: string; mime_type: string };
          document?: { id: string; mime_type: string; filename: string };
        }>;
        statuses?: Array<{ id: string; status: string; recipient_id: string }>;
      };
    }>;
  }>;
}
