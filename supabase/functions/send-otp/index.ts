import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OTPRequest {
  type: "email" | "phone";
  destination: string;
  purpose: "reset_password" | "verify";
}

const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const sendSMSOTP = async (phone: string, otp: string): Promise<boolean> => {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");

  if (!accountSid || !authToken || !twilioPhone) {
    console.error("Missing Twilio credentials");
    return false;
  }

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        },
        body: new URLSearchParams({
          To: phone,
          From: twilioPhone,
          Body: `Your verification code is: ${otp}. This code expires in 10 minutes.`,
        }),
      }
    );

    const result = await response.json();
    console.log("SMS OTP sent:", result.sid ? "success" : "failed");
    return !!result.sid;
  } catch (error) {
    console.error("Error sending SMS OTP:", error);
    return false;
  }
};

const sendEmailOTP = async (email: string, otp: string): Promise<boolean> => {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  if (!resendApiKey) {
    console.error("Missing Resend API key");
    return false;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: "Emergency App <onboarding@resend.dev>",
        to: [email],
        subject: "Your Verification Code",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Verification Code</h2>
            <p>Your verification code is:</p>
            <div style="background: #f5f5f5; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333;">${otp}</span>
            </div>
            <p style="color: #666;">This code expires in 10 minutes.</p>
            <p style="color: #999; font-size: 12px;">If you didn't request this code, please ignore this email.</p>
          </div>
        `,
      }),
    });

    const result = await response.json();
    console.log("Email OTP response:", JSON.stringify(result));
    
    // Check for success - Resend returns id on success
    if (result.id) {
      console.log("Email OTP sent successfully:", result.id);
      return true;
    }
    
    // Log error details for debugging
    if (result.error || result.message) {
      console.error("Resend API error:", result.error || result.message);
    }
    
    return false;
  } catch (error) {
    console.error("Error sending email OTP:", error);
    return false;
  }
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { type, destination, purpose }: OTPRequest = await req.json();

    if (!type || !destination || !purpose) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    // Store OTP in database (we'll need to create this table)
    // For now, we'll use a simple approach with the profiles table metadata
    // In production, you'd want a separate otp_codes table

    // Send OTP
    let sent = false;
    if (type === "phone") {
      sent = await sendSMSOTP(destination, otp);
    } else {
      sent = await sendEmailOTP(destination, otp);
    }

    if (!sent) {
      return new Response(
        JSON.stringify({ error: `Failed to send OTP via ${type}` }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Store OTP hash for verification (simple approach - in production use proper storage)
    // We'll store in a temp way using RPC or direct insert
    const otpHash = btoa(`${destination}:${otp}:${expiresAt}`);
    
    console.log(`OTP sent to ${type}: ${destination}, purpose: ${purpose}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `OTP sent to ${type}`,
        otpToken: otpHash // This is used for verification
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-otp function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
