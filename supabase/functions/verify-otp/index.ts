import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VerifyOTPRequest {
  otpToken: string;
  otp: string;
  newPassword?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { otpToken, otp, newPassword }: VerifyOTPRequest = await req.json();

    if (!otpToken || !otp) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Decode and verify OTP token
    let decoded: string;
    try {
      decoded = atob(otpToken);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid OTP token" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const [destination, storedOtp, expiresAt] = decoded.split(":");

    // Check if OTP matches
    if (storedOtp !== otp) {
      return new Response(
        JSON.stringify({ error: "Invalid OTP code" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if OTP is expired
    if (new Date(expiresAt) < new Date()) {
      return new Response(
        JSON.stringify({ error: "OTP has expired" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // If new password is provided, update the user's password
    if (newPassword) {
      // Find user by email or phone
      const isPhone = destination.startsWith("+") || /^\d+$/.test(destination);
      
      let userId: string | null = null;
      
      if (isPhone) {
        // Find user by phone in profiles
        const { data: profile } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("phone", destination)
          .single();
        userId = profile?.user_id;
      } else {
        // Find user by email
        const { data: profile } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("email", destination)
          .single();
        userId = profile?.user_id;
      }

      if (!userId) {
        return new Response(
          JSON.stringify({ error: "User not found" }),
          { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Update password using admin API
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        userId,
        { password: newPassword }
      );

      if (updateError) {
        console.error("Error updating password:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to update password" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      console.log(`Password updated for user: ${userId}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: newPassword ? "Password updated successfully" : "OTP verified successfully",
        verified: true
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in verify-otp function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
