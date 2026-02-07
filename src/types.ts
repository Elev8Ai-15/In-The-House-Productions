// Shared types for the entire application

export type Bindings = {
  DB: D1Database
  JWT_SECRET?: string
  SETUP_KEY?: string
  DEFAULT_EMPLOYEE_PASSWORD?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_PUBLISHABLE_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  RESEND_API_KEY?: string
  TWILIO_ACCOUNT_SID?: string
  TWILIO_AUTH_TOKEN?: string
  TWILIO_PHONE_NUMBER?: string
  REFERSION_PUBLIC_KEY?: string
  REFERSION_SECRET_KEY?: string
}
