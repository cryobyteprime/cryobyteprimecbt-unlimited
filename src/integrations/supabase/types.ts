export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_profiles: {
        Row: {
          createdAt: string
          email: string
          id: string
          name: string
          role: string
        }
        Insert: {
          createdAt?: string
          email: string
          id: string
          name: string
          role: string
        }
        Update: {
          createdAt?: string
          email?: string
          id?: string
          name?: string
          role?: string
        }
        Relationships: []
      }
      att_edit_requests: {
        Row: {
          classSN: string
          createdAt: string
          email: string
          id: string
          name: string
          reason: string
          rejectionNote: string | null
          requestedStatus: string
          resolvedAt: string | null
          resolvedBy: string | null
          sessionId: string
          status: string
        }
        Insert: {
          classSN: string
          createdAt?: string
          email: string
          id: string
          name: string
          reason: string
          rejectionNote?: string | null
          requestedStatus: string
          resolvedAt?: string | null
          resolvedBy?: string | null
          sessionId: string
          status?: string
        }
        Update: {
          classSN?: string
          createdAt?: string
          email?: string
          id?: string
          name?: string
          reason?: string
          rejectionNote?: string | null
          requestedStatus?: string
          resolvedAt?: string | null
          resolvedBy?: string | null
          sessionId?: string
          status?: string
        }
        Relationships: []
      }
      att_records: {
        Row: {
          class: string
          classSN: string
          date: string
          email: string
          id: string
          name: string
          round: string | null
          sessionId: string
          status: string
          timestamp: string
        }
        Insert: {
          class: string
          classSN: string
          date: string
          email: string
          id: string
          name: string
          round?: string | null
          sessionId: string
          status: string
          timestamp?: string
        }
        Update: {
          class?: string
          classSN?: string
          date?: string
          email?: string
          id?: string
          name?: string
          round?: string | null
          sessionId?: string
          status?: string
          timestamp?: string
        }
        Relationships: []
      }
      att_sessions: {
        Row: {
          class: string
          createdAt: string
          createdBy: string
          date: string
          id: string
          notes: string | null
          round1Serials: string[]
          round2Serials: string[]
          status: string
          topic: string
        }
        Insert: {
          class: string
          createdAt?: string
          createdBy: string
          date: string
          id: string
          notes?: string | null
          round1Serials?: string[]
          round2Serials?: string[]
          status?: string
          topic: string
        }
        Update: {
          class?: string
          createdAt?: string
          createdBy?: string
          date?: string
          id?: string
          notes?: string | null
          round1Serials?: string[]
          round2Serials?: string[]
          status?: string
          topic?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          id: string
          newValue: string | null
          originalValue: string | null
          page: string
          reason: string
          timestamp: string
          userName: string
          userRole: string
        }
        Insert: {
          action: string
          id: string
          newValue?: string | null
          originalValue?: string | null
          page: string
          reason: string
          timestamp?: string
          userName: string
          userRole: string
        }
        Update: {
          action?: string
          id?: string
          newValue?: string | null
          originalValue?: string | null
          page?: string
          reason?: string
          timestamp?: string
          userName?: string
          userRole?: string
        }
        Relationships: []
      }
      config: {
        Row: {
          assessmentType: string
          examActivated: boolean
          id: string
          protectionPassword: string
          superadminPassword: string
        }
        Insert: {
          assessmentType?: string
          examActivated?: boolean
          id?: string
          protectionPassword?: string
          superadminPassword?: string
        }
        Update: {
          assessmentType?: string
          examActivated?: boolean
          id?: string
          protectionPassword?: string
          superadminPassword?: string
        }
        Relationships: []
      }
      deletion_requests: {
        Row: {
          createdAt: string
          id: string
          page: string
          reason: string
          requestedBy: string
          resolutionReason: string | null
          resolvedAt: string | null
          resolvedBy: string | null
          role: string
          scope: string
          status: string
        }
        Insert: {
          createdAt?: string
          id: string
          page: string
          reason: string
          requestedBy: string
          resolutionReason?: string | null
          resolvedAt?: string | null
          resolvedBy?: string | null
          role: string
          scope: string
          status?: string
        }
        Update: {
          createdAt?: string
          id?: string
          page?: string
          reason?: string
          requestedBy?: string
          resolutionReason?: string | null
          resolvedAt?: string | null
          resolvedBy?: string | null
          role?: string
          scope?: string
          status?: string
        }
        Relationships: []
      }
      exam_eligibility: {
        Row: {
          email: string
          id: string
          overrideBy: string | null
          overrideReason: string | null
          reason: string
          sessionId: string
          status: string
          updatedAt: string
        }
        Insert: {
          email: string
          id: string
          overrideBy?: string | null
          overrideReason?: string | null
          reason: string
          sessionId: string
          status: string
          updatedAt?: string
        }
        Update: {
          email?: string
          id?: string
          overrideBy?: string | null
          overrideReason?: string | null
          reason?: string
          sessionId?: string
          status?: string
          updatedAt?: string
        }
        Relationships: []
      }
      questions: {
        Row: {
          answer: string
          createdAt: string
          difficulty: string | null
          id: string
          options: string[] | null
          subject: string | null
          text: string
          type: string
        }
        Insert: {
          answer: string
          createdAt?: string
          difficulty?: string | null
          id: string
          options?: string[] | null
          subject?: string | null
          text: string
          type: string
        }
        Update: {
          answer?: string
          createdAt?: string
          difficulty?: string | null
          id?: string
          options?: string[] | null
          subject?: string | null
          text?: string
          type?: string
        }
        Relationships: []
      }
      results: {
        Row: {
          answers: Json
          attemptId: string
          class: string
          classSN: string
          email: string
          examSessionId: string
          id: string
          name: string
          percentage: number
          score: number
          submittedAt: string
          totalQuestions: number
        }
        Insert: {
          answers: Json
          attemptId: string
          class: string
          classSN: string
          email: string
          examSessionId: string
          id: string
          name: string
          percentage: number
          score: number
          submittedAt?: string
          totalQuestions: number
        }
        Update: {
          answers?: Json
          attemptId?: string
          class?: string
          classSN?: string
          email?: string
          examSessionId?: string
          id?: string
          name?: string
          percentage?: number
          score?: number
          submittedAt?: string
          totalQuestions?: number
        }
        Relationships: []
      }
      students: {
        Row: {
          class: string
          classSN: string
          createdAt: string
          email: string
          gender: string | null
          id: string
          name: string
          phone: string | null
          updatedAt: string | null
        }
        Insert: {
          class: string
          classSN: string
          createdAt?: string
          email: string
          gender?: string | null
          id: string
          name: string
          phone?: string | null
          updatedAt?: string | null
        }
        Update: {
          class?: string
          classSN?: string
          createdAt?: string
          email?: string
          gender?: string | null
          id?: string
          name?: string
          phone?: string | null
          updatedAt?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      student_cbt_log: {
        Args: {
          p_action: string
          p_email: string
          p_new_value: string
          p_page: string
          p_reason: string
        }
        Returns: undefined
      }
      student_cbt_result: {
        Args: { p_class_sn: string; p_email: string }
        Returns: Json
      }
      student_cbt_start: {
        Args: { p_class_sn: string; p_email: string }
        Returns: Json
      }
      student_cbt_submit: {
        Args: {
          p_answers: Json
          p_attempt_id: string
          p_class_sn: string
          p_email: string
          p_session_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "superadmin" | "admin" | "staff"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["superadmin", "admin", "staff"],
    },
  },
} as const
